#!/bin/bash
# YiOne SSL Certificate Setup
# Uses Let's Encrypt (certbot) to obtain SSL certificates for the API domain.
# Run from local machine: ./scripts/setup-ssl.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/deploy.config.sh"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: Config file not found: $CONFIG_FILE"
  exit 1
fi

source "$CONFIG_FILE"

DOMAIN="${API_DOMAIN:-api.yione.online}"

SSH_OPTS="-o StrictHostKeyChecking=accept-new"
[[ -n "${PEM_PATH:-}" ]] && SSH_OPTS="$SSH_OPTS -i $PEM_PATH"
[[ -n "${SSH_PORT:-}" ]] && SSH_OPTS="$SSH_OPTS -p $SSH_PORT"

echo "==> Setting up SSL for ${DOMAIN} on ${SERVER_HOST} ..."

ssh $SSH_OPTS "${SSH_USER}@${SERVER_HOST}" bash -s -- "$DOMAIN" "$PROJECT_DIR" << 'REMOTE_SCRIPT'
set -euo pipefail

DOMAIN="$1"
PROJECT_DIR="$2"

export DEBIAN_FRONTEND=noninteractive

echo ""
echo "=============================="
echo "  SSL Certificate Setup"
echo "  Domain: ${DOMAIN}"
echo "=============================="

# ── 1. Install certbot ──
echo ""
echo ">> Checking certbot ..."
if command -v certbot &>/dev/null; then
  echo "  [OK] certbot already installed"
else
  echo "  [INSTALLING] certbot ..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq certbot python3-certbot-nginx
  echo "  Installed certbot"
fi

# ── 2. Set up temporary nginx config for domain verification ──
echo ""
echo ">> Preparing Nginx for certificate verification ..."

# Create a minimal HTTP-only config for certbot verification
sudo tee /etc/nginx/sites-available/yione-temp.conf > /dev/null << NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/yione-temp.conf /etc/nginx/sites-enabled/yione-temp.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo rm -f /etc/nginx/sites-enabled/yione.conf
sudo nginx -t && sudo systemctl reload nginx
echo "  Temporary HTTP config active"

# ── 3. Obtain certificate ──
echo ""
echo ">> Requesting SSL certificate from Let's Encrypt ..."
sudo certbot certonly \
  --nginx \
  --non-interactive \
  --agree-tos \
  --register-unsafely-without-email \
  -d "$DOMAIN"

echo "  Certificate obtained!"

# ── 4. Set up production nginx config with SSL ──
echo ""
echo ">> Configuring Nginx with SSL ..."

# Remove temporary config
sudo rm -f /etc/nginx/sites-enabled/yione-temp.conf
sudo rm -f /etc/nginx/sites-available/yione-temp.conf

# Create production SSL config
sudo tee /etc/nginx/sites-available/yione.conf > /dev/null << 'NGINX'
upstream yione_api {
    server 127.0.0.1:4000;
}

server {
    listen 80;
    server_name DOMAIN_PLACEHOLDER;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name DOMAIN_PLACEHOLDER;

    ssl_certificate /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    client_max_body_size 20M;

    # API proxy
    location / {
        proxy_pass http://yione_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    # SSE streaming — disable buffering
    location ~ /conversations/.*/stream {
        proxy_pass http://yione_api;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
    }

    # Uploads static files
    location /uploads/ {
        alias PROJECT_DIR_PLACEHOLDER/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Health check
    location /api/health {
        proxy_pass http://yione_api;
        access_log off;
    }
}
NGINX

# Replace placeholders
sudo sed -i "s|DOMAIN_PLACEHOLDER|${DOMAIN}|g" /etc/nginx/sites-available/yione.conf
sudo sed -i "s|PROJECT_DIR_PLACEHOLDER|${PROJECT_DIR}|g" /etc/nginx/sites-available/yione.conf

sudo ln -sf /etc/nginx/sites-available/yione.conf /etc/nginx/sites-enabled/yione.conf

if sudo nginx -t; then
  sudo systemctl reload nginx
  echo "  Nginx SSL config active!"
else
  echo "  ERROR: Nginx config test failed"
  sudo nginx -t
  exit 1
fi

# ── 5. Set up auto-renewal ──
echo ""
echo ">> Setting up certificate auto-renewal ..."
# Certbot installs a systemd timer by default, verify it's active
if sudo systemctl is-active --quiet certbot.timer 2>/dev/null; then
  echo "  [OK] Auto-renewal timer active"
else
  sudo systemctl enable --now certbot.timer 2>/dev/null || \
    (echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'" | sudo crontab -l 2>/dev/null; echo) | sort -u | sudo crontab -
  echo "  Auto-renewal configured"
fi

# ── Summary ──
echo ""
echo "=============================="
echo "  SSL Setup Complete!"
echo "=============================="
echo ""
echo "  Domain:  https://${DOMAIN}"
echo "  Cert:    /etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
echo "  Key:     /etc/letsencrypt/live/${DOMAIN}/privkey.pem"
echo "  Renewal: automatic (certbot timer)"
echo ""
REMOTE_SCRIPT

echo ""
echo "==> SSL setup finished! Try: https://${DOMAIN}/api/health"
