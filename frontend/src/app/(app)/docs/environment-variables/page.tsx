'use client';

export default function EnvironmentVariablesDocsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10 py-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Environment Variables</h1>
        <p className="text-muted-foreground mt-2">
          Ship Dock platform environment variables reference. Configure these in your deployment's <code className="rounded bg-muted px-1.5 py-0.5 text-xs">.env</code> file or <code className="rounded bg-muted px-1.5 py-0.5 text-xs">deploy.config.sh</code>.
        </p>
      </div>

      {/* Core */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">Core</h2>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Basic application settings required for the platform to run.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4 text-left font-medium">Variable</th>
                <th className="py-2 pr-4 text-left font-medium">Description</th>
                <th className="py-2 pr-4 text-left font-medium">Default</th>
              </tr>
            </thead>
            <tbody className="text-foreground/80">
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">PORT</code></td>
                <td className="py-2 pr-4">Backend API listening port</td>
                <td className="py-2 pr-4">4000</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">NODE_ENV</code></td>
                <td className="py-2 pr-4">Application environment. Set to <code className="rounded bg-muted px-1.5 py-0.5 text-xs">production</code> for deployed instances</td>
                <td className="py-2 pr-4">development</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">BASE_URL</code></td>
                <td className="py-2 pr-4">Backend public URL, used for generating webhook URLs and OAuth callbacks</td>
                <td className="py-2 pr-4">—</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">FRONTEND_URL</code></td>
                <td className="py-2 pr-4">Frontend public URL, used for OAuth redirect after authorization</td>
                <td className="py-2 pr-4">http://localhost:3000</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">SERVER_IP</code></td>
                <td className="py-2 pr-4">Server public IP address, used in deployment context and DNS configuration</td>
                <td className="py-2 pr-4">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Database */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">Database & Redis</h2>
        <p className="text-sm text-foreground/80 leading-relaxed">
          PostgreSQL is the primary database. Redis is used for BullMQ job queues and caching.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4 text-left font-medium">Variable</th>
                <th className="py-2 pr-4 text-left font-medium">Description</th>
                <th className="py-2 pr-4 text-left font-medium">Default</th>
              </tr>
            </thead>
            <tbody className="text-foreground/80">
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">DATABASE_URL</code></td>
                <td className="py-2 pr-4">PostgreSQL connection string, e.g. <code className="rounded bg-muted px-1.5 py-0.5 text-xs">postgresql://user:pass@localhost:5432/dbname</code></td>
                <td className="py-2 pr-4">—</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">REDIS_URL</code></td>
                <td className="py-2 pr-4">Full Redis connection URL. If set, takes precedence over individual REDIS_* vars</td>
                <td className="py-2 pr-4">—</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">REDIS_HOST</code></td>
                <td className="py-2 pr-4">Redis server hostname (used if REDIS_URL is not set)</td>
                <td className="py-2 pr-4">localhost</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">REDIS_PORT</code></td>
                <td className="py-2 pr-4">Redis server port</td>
                <td className="py-2 pr-4">6379</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">REDIS_PASSWORD</code></td>
                <td className="py-2 pr-4">Redis authentication password</td>
                <td className="py-2 pr-4">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Security */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">Security & Encryption</h2>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Used for JWT authentication and encrypting sensitive data (API keys, OAuth tokens) stored in the database.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4 text-left font-medium">Variable</th>
                <th className="py-2 pr-4 text-left font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="text-foreground/80">
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">JWT_SECRET</code></td>
                <td className="py-2 pr-4">Secret key for signing access tokens. Generate with <code className="rounded bg-muted px-1.5 py-0.5 text-xs">openssl rand -base64 32</code></td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">JWT_REFRESH_SECRET</code></td>
                <td className="py-2 pr-4">Secret key for signing refresh tokens. Should be different from JWT_SECRET</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">ENCRYPTION_KEY</code></td>
                <td className="py-2 pr-4">32-byte hex string for AES-256 encryption. Generate with <code className="rounded bg-muted px-1.5 py-0.5 text-xs">openssl rand -hex 32</code></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <strong>Important:</strong> Changing these values after deployment will invalidate all existing sessions and make encrypted data unreadable. Back up before rotating.
        </div>
      </section>

      {/* Project Management */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">Project Management</h2>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Controls where deployed projects are stored and which ports they can use.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4 text-left font-medium">Variable</th>
                <th className="py-2 pr-4 text-left font-medium">Description</th>
                <th className="py-2 pr-4 text-left font-medium">Default</th>
              </tr>
            </thead>
            <tbody className="text-foreground/80">
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">PROJECTS_DIR</code></td>
                <td className="py-2 pr-4">Base directory for project files on the server</td>
                <td className="py-2 pr-4">/var/www</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">PORT_RANGE_MIN</code></td>
                <td className="py-2 pr-4">Minimum port assigned to project services</td>
                <td className="py-2 pr-4">3001</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">PORT_RANGE_MAX</code></td>
                <td className="py-2 pr-4">Maximum port assigned to project services</td>
                <td className="py-2 pr-4">3999</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* MinIO */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">MinIO Object Storage</h2>
        <p className="text-sm text-foreground/80 leading-relaxed">
          MinIO is used for storing project build artifacts, logs, and uploaded files. You can use any S3-compatible storage service.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4 text-left font-medium">Variable</th>
                <th className="py-2 pr-4 text-left font-medium">Description</th>
                <th className="py-2 pr-4 text-left font-medium">Default</th>
              </tr>
            </thead>
            <tbody className="text-foreground/80">
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">MINIO_ENDPOINT</code></td>
                <td className="py-2 pr-4">MinIO server hostname or IP address</td>
                <td className="py-2 pr-4">—</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">MINIO_PORT</code></td>
                <td className="py-2 pr-4">MinIO API port</td>
                <td className="py-2 pr-4">9000</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">MINIO_ACCESS_KEY</code></td>
                <td className="py-2 pr-4">MinIO access key (like AWS Access Key ID)</td>
                <td className="py-2 pr-4">—</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">MINIO_SECRET_KEY</code></td>
                <td className="py-2 pr-4">MinIO secret key (like AWS Secret Access Key)</td>
                <td className="py-2 pr-4">—</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">MINIO_USE_SSL</code></td>
                <td className="py-2 pr-4">Enable TLS for MinIO connections</td>
                <td className="py-2 pr-4">false</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* GitHub App */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">GitHub App</h2>
        <p className="text-sm text-foreground/80 leading-relaxed">
          GitHub App integration enables repository connections, automatic deployments via webhooks, and Git-based project imports. Create a GitHub App at{' '}
          <strong>GitHub → Settings → Developer settings → GitHub Apps</strong>.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4 text-left font-medium">Variable</th>
                <th className="py-2 pr-4 text-left font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="text-foreground/80">
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">GITHUB_APP_ID</code></td>
                <td className="py-2 pr-4">GitHub App ID, found on the app's settings page</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">GITHUB_APP_PRIVATE_KEY</code></td>
                <td className="py-2 pr-4">Base64-encoded private key (PEM). Generate in the app settings, then encode: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">base64 -i key.pem</code></td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">GITHUB_APP_WEBHOOK_SECRET</code></td>
                <td className="py-2 pr-4">Secret for verifying webhook payloads from GitHub. Set the same value in your GitHub App webhook settings</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">GITHUB_APP_CLIENT_ID</code></td>
                <td className="py-2 pr-4">OAuth Client ID for user authentication via GitHub</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">GITHUB_APP_CLIENT_SECRET</code></td>
                <td className="py-2 pr-4">OAuth Client Secret for user authentication via GitHub</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">GITHUB_APP_SLUG</code></td>
                <td className="py-2 pr-4">GitHub App URL slug, used for generating the installation link</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground space-y-2">
          <p><strong>Setup steps:</strong></p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Create a GitHub App with repository read permissions and webhook push events</li>
            <li>Set the webhook URL to <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{'https://<your-api-domain>/api/webhooks/github'}</code></li>
            <li>Generate a private key and base64-encode it</li>
            <li>Copy the App ID, Client ID, and Client Secret to your environment</li>
          </ol>
        </div>
      </section>

      {/* Google Analytics */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">Google Analytics (GA4)</h2>
        <p className="text-sm text-foreground/80 leading-relaxed">
          OAuth credentials for connecting Google Analytics accounts. See the <strong>Analytics Integration</strong> doc for the full setup guide.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4 text-left font-medium">Variable</th>
                <th className="py-2 pr-4 text-left font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="text-foreground/80">
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">GOOGLE_CLIENT_ID</code></td>
                <td className="py-2 pr-4">OAuth 2.0 Client ID from Google Cloud Console</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">GOOGLE_CLIENT_SECRET</code></td>
                <td className="py-2 pr-4">OAuth 2.0 Client Secret</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">GOOGLE_REDIRECT_URI</code></td>
                <td className="py-2 pr-4">OAuth callback URL, e.g. <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{'https://<api-domain>/api/analytics/callback/google'}</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Microsoft Clarity */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">Microsoft Clarity</h2>
        <p className="text-sm text-foreground/80 leading-relaxed">
          OAuth credentials for connecting Microsoft Clarity accounts.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4 text-left font-medium">Variable</th>
                <th className="py-2 pr-4 text-left font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="text-foreground/80">
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">MICROSOFT_CLIENT_ID</code></td>
                <td className="py-2 pr-4">Application (client) ID from Azure App Registration (the <code className="rounded bg-muted px-1.5 py-0.5 text-xs">appId</code> in the manifest, not the secret's keyId)</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">MICROSOFT_CLIENT_SECRET</code></td>
                <td className="py-2 pr-4">Client secret value from Azure App Registration → Certificates & secrets</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">MICROSOFT_REDIRECT_URI</code></td>
                <td className="py-2 pr-4">OAuth callback URL, e.g. <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{'https://<api-domain>/api/analytics/callback/microsoft'}</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Domain & SSL */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">Domain & SSL</h2>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Domain configuration is managed per-project through the Ship Dock UI. When a project has a domain configured, the deployment pipeline automatically:
        </p>
        <ol className="list-decimal list-inside space-y-2 text-sm text-foreground/80">
          <li>Generates an Nginx server block with reverse proxy to the project's assigned port</li>
          <li>Requests a Let's Encrypt SSL certificate via Certbot</li>
          <li>Configures HTTP → HTTPS redirect</li>
          <li>Sets up automatic certificate renewal</li>
        </ol>
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <strong>Note:</strong> If you've added a DNS provider (Namecheap or GoDaddy) in Settings → Domains, Ship Dock will also automatically create the DNS A record pointing to your server.
        </div>
      </section>

      {/* Example */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">Minimal .env Example</h2>
        <pre className="rounded-lg border bg-muted/50 p-4 text-xs overflow-x-auto leading-relaxed">{`# Core
PORT=4000
NODE_ENV=production
BASE_URL=https://api.example.com
FRONTEND_URL=https://example.com
SERVER_IP=1.2.3.4

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/shipdock

# Redis
REDIS_URL=redis://:password@localhost:6379

# Security (generate your own!)
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-secret
ENCRYPTION_KEY=your-64-char-hex-string

# MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=miniosecret

# GitHub App (optional)
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY=base64-encoded-pem
GITHUB_APP_WEBHOOK_SECRET=your-webhook-secret
GITHUB_APP_CLIENT_ID=Iv1.abc123
GITHUB_APP_CLIENT_SECRET=your-client-secret
GITHUB_APP_SLUG=your-app-name

# Google Analytics (optional)
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://api.example.com/api/analytics/callback/google

# Microsoft Clarity (optional)
MICROSOFT_CLIENT_ID=your-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret
MICROSOFT_REDIRECT_URI=https://api.example.com/api/analytics/callback/microsoft`}</pre>
      </section>
    </div>
  );
}
