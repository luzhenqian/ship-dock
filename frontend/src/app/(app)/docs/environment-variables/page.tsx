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
                <td className="py-2 pr-4"><strong>Required for auto-DNS.</strong> Server public IP address. When set, Ship Dock automatically creates DNS A records via your domain provider (GoDaddy/Namecheap) during deployment, before requesting SSL certificates. Without this, you must manually add DNS records. Auto-detected during installation via <code className="rounded bg-muted px-1.5 py-0.5 text-xs">curl -s ifconfig.me</code></td>
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
          GitHub App integration enables repository connections, automatic deployments via webhooks (push, PR merge, release), and Git-based project imports.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4 text-left font-medium">Variable</th>
                <th className="py-2 pr-4 text-left font-medium">Description</th>
                <th className="py-2 pr-4 text-left font-medium">Where to find</th>
              </tr>
            </thead>
            <tbody className="text-foreground/80">
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">GITHUB_APP_ID</code></td>
                <td className="py-2 pr-4">GitHub App ID (numeric)</td>
                <td className="py-2 pr-4">App settings page → General → About → App ID</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">GITHUB_APP_PRIVATE_KEY</code></td>
                <td className="py-2 pr-4">Base64-encoded RSA private key, used to sign JWT for API authentication</td>
                <td className="py-2 pr-4">App settings → General → Private keys → Generate</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">GITHUB_APP_WEBHOOK_SECRET</code></td>
                <td className="py-2 pr-4">Secret for HMAC-SHA256 signature verification of webhook payloads</td>
                <td className="py-2 pr-4">App settings → General → Webhook → Webhook secret</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">GITHUB_APP_CLIENT_ID</code></td>
                <td className="py-2 pr-4">OAuth Client ID for user authorization flow</td>
                <td className="py-2 pr-4">App settings → General → About → Client ID</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">GITHUB_APP_CLIENT_SECRET</code></td>
                <td className="py-2 pr-4">OAuth Client Secret</td>
                <td className="py-2 pr-4">App settings → General → Client secrets → Generate</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">GITHUB_APP_SLUG</code></td>
                <td className="py-2 pr-4">App URL slug, used to build installation link: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{'github.com/apps/<slug>'}</code></td>
                <td className="py-2 pr-4">The URL-friendly name shown in your app's public URL</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="space-y-4">
          <h3 className="text-base font-semibold">Step-by-step Setup</h3>

          {/* Step 1 */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">1. Create a GitHub App</p>
            <p className="text-sm text-foreground/80">
              Go to{' '}
              <a href="https://github.com/settings/apps/new" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4 hover:text-foreground/70">
                https://github.com/settings/apps/new
              </a>
              {' '}and fill in the following fields:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 pr-4 text-left font-medium">Field</th>
                    <th className="py-2 pr-4 text-left font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="text-foreground/80">
                  <tr className="border-b">
                    <td className="py-2 pr-4">GitHub App name</td>
                    <td className="py-2 pr-4">Your app name, e.g. <code className="rounded bg-muted px-1.5 py-0.5 text-xs">ship-dock</code> (this becomes the slug)</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">Description</td>
                    <td className="py-2 pr-4">Optional, e.g. "Self-hosted deployment platform"</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">Homepage URL</td>
                    <td className="py-2 pr-4">Your Ship Dock frontend URL, e.g. <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{'https://<your-frontend-domain>'}</code></td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">Callback URL</td>
                    <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{'https://<your-frontend-domain>'}</code></td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">Setup URL</td>
                    <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{'https://<your-frontend-domain>/settings'}</code> — users are redirected here after installing the app, with <code className="rounded bg-muted px-1.5 py-0.5 text-xs">?installation_id=xxx&setup_action=install</code> appended automatically</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">Redirect on update</td>
                    <td className="py-2 pr-4">Checked — also redirects when users update their installation (e.g. change repo access)</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">Expire user authorization tokens</td>
                    <td className="py-2 pr-4">Checked (enabled)</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">Request user authorization (OAuth) during installation</td>
                    <td className="py-2 pr-4">Unchecked</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">Enable Device Flow</td>
                    <td className="py-2 pr-4">Unchecked</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Step 2 */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">2. Configure Webhook</p>
            <p className="text-sm text-foreground/80">In the "Webhook" section of the creation form:</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 pr-4 text-left font-medium">Field</th>
                    <th className="py-2 pr-4 text-left font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="text-foreground/80">
                  <tr className="border-b">
                    <td className="py-2 pr-4">Active</td>
                    <td className="py-2 pr-4">Checked</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">Webhook URL</td>
                    <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{'https://<your-api-domain>/api/webhooks/github'}</code></td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">Webhook secret</td>
                    <td className="py-2 pr-4">A random string. Generate with: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">openssl rand -hex 32</code> — save this as <code className="rounded bg-muted px-1.5 py-0.5 text-xs">GITHUB_APP_WEBHOOK_SECRET</code></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Step 3 */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">3. Set Permissions</p>
            <p className="text-sm text-foreground/80">Under "Permissions" → "Repository permissions":</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 pr-4 text-left font-medium">Permission</th>
                    <th className="py-2 pr-4 text-left font-medium">Access</th>
                    <th className="py-2 pr-4 text-left font-medium">Purpose</th>
                  </tr>
                </thead>
                <tbody className="text-foreground/80">
                  <tr className="border-b">
                    <td className="py-2 pr-4">Contents</td>
                    <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">Read-only</code></td>
                    <td className="py-2 pr-4">Read repository files for deployment</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">Pull requests</td>
                    <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">Read-only</code></td>
                    <td className="py-2 pr-4">Enables "Pull request" event subscription for deploy on PR merge</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">Metadata</td>
                    <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">Read-only</code></td>
                    <td className="py-2 pr-4">List repositories and basic info</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">Webhooks</td>
                    <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">Read and write</code></td>
                    <td className="py-2 pr-4">Create/manage per-repo webhooks for auto-deploy</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Step 4 */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">4. Subscribe to Events</p>
            <p className="text-sm text-foreground/80">Under "Subscribe to events", check the following. Note: some events (like Pull requests) only appear after enabling the corresponding permission in Step 3.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 pr-4 text-left font-medium">Event</th>
                    <th className="py-2 pr-4 text-left font-medium">Triggers deployment when</th>
                  </tr>
                </thead>
                <tbody className="text-foreground/80">
                  <tr className="border-b">
                    <td className="py-2 pr-4">Push</td>
                    <td className="py-2 pr-4">Code is pushed to a matching branch</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">Pull request</td>
                    <td className="py-2 pr-4">A PR is merged (closed + merged)</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">Release</td>
                    <td className="py-2 pr-4">A new release is published</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">Create</td>
                    <td className="py-2 pr-4">A branch or tag is created</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">Delete</td>
                    <td className="py-2 pr-4">A branch or tag is deleted</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Step 5 */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">5. Installation Access</p>
            <p className="text-sm text-foreground/80">Under "Where can this GitHub App be installed?":</p>
            <ul className="list-disc list-inside text-sm text-foreground/80 space-y-1">
              <li><strong>Only on this account</strong> — if only you will use Ship Dock</li>
              <li><strong>Any account</strong> — if others will install your app on their repos</li>
            </ul>
          </div>

          {/* Step 6 */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">6. After Creation — Collect Credentials</p>
            <p className="text-sm text-foreground/80">
              After clicking "Create GitHub App", you'll be redirected to the app settings page at{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{'https://github.com/settings/apps/<your-app-slug>'}</code>.
              Collect the following:
            </p>
            <ol className="list-decimal list-inside text-sm text-foreground/80 space-y-2">
              <li>
                <strong>App ID</strong> and <strong>Client ID</strong> — shown on the General page under "About"
              </li>
              <li>
                <strong>Client Secret</strong> — click "Generate a new client secret" and copy the value immediately (it won't be shown again)
              </li>
              <li>
                <strong>Private Key</strong> — scroll down to "Private keys", click "Generate a private key". A <code className="rounded bg-muted px-1.5 py-0.5 text-xs">.pem</code> file will be downloaded. Encode it:
                <pre className="mt-1 rounded-lg border bg-muted/50 p-3 text-xs">{'base64 -i <your-app-name>.pem | tr -d \'\\n\''}</pre>
                The output is your <code className="rounded bg-muted px-1.5 py-0.5 text-xs">GITHUB_APP_PRIVATE_KEY</code> value.
              </li>
              <li>
                <strong>Slug</strong> — the URL-friendly name in <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{'github.com/apps/<slug>'}</code>
              </li>
            </ol>
          </div>
        </div>

        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <strong>How it works:</strong> After configuration, users can go to <strong>Project Settings → Webhooks</strong> to connect a GitHub repository. When events matching the configured filters (branch, path, event type) are received, Ship Dock automatically triggers a new deployment.
        </div>
      </section>

      {/* Google Analytics */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">Google Analytics (GA4)</h2>
        <p className="text-sm text-foreground/80 leading-relaxed">
          OAuth credentials for connecting Google Analytics accounts. Enables GA4 property management and report building directly in Ship Dock.
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
                <td className="py-2 pr-4">OAuth 2.0 Client ID</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">GOOGLE_CLIENT_SECRET</code></td>
                <td className="py-2 pr-4">OAuth 2.0 Client Secret</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">GOOGLE_REDIRECT_URI</code></td>
                <td className="py-2 pr-4">OAuth callback URL: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{'https://<your-api-domain>/api/analytics/callback/google'}</code></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Setup Steps:</p>
          <ol className="list-decimal list-inside text-sm text-foreground/80 space-y-2">
            <li>
              Go to{' '}
              <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4 hover:text-foreground/70">
                Google Cloud Console → Credentials
              </a>
              , click <strong>Create Credentials → OAuth client ID</strong>
            </li>
            <li>Application type: <strong>Web application</strong></li>
            <li>Authorized redirect URIs: add <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{'https://<your-api-domain>/api/analytics/callback/google'}</code></li>
            <li>
              Enable the following APIs in{' '}
              <a href="https://console.cloud.google.com/apis/library" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4 hover:text-foreground/70">
                API Library
              </a>
              :
              <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                <li>Google Analytics Admin API</li>
                <li>Google Analytics Data API</li>
              </ul>
            </li>
            <li>
              Go to{' '}
              <a href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4 hover:text-foreground/70">
                Google Auth Platform → Audience
              </a>
              {' '}and either add test users (for testing) or publish the app (for production, requires Google review)
            </li>
          </ol>
        </div>
      </section>

      {/* Microsoft Clarity */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">Microsoft Clarity</h2>
        <p className="text-sm text-foreground/80 leading-relaxed">
          OAuth credentials for connecting Microsoft Clarity accounts. Enables Clarity project management and linking to deployed projects.
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
                <td className="py-2 pr-4">Application (client) ID — the <code className="rounded bg-muted px-1.5 py-0.5 text-xs">appId</code> from the manifest, not the secret's keyId</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">MICROSOFT_CLIENT_SECRET</code></td>
                <td className="py-2 pr-4">Client secret value (not the secret ID)</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">MICROSOFT_REDIRECT_URI</code></td>
                <td className="py-2 pr-4">OAuth callback URL: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{'https://<your-api-domain>/api/analytics/callback/microsoft'}</code></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Setup Steps:</p>
          <ol className="list-decimal list-inside text-sm text-foreground/80 space-y-2">
            <li>
              Go to{' '}
              <a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4 hover:text-foreground/70">
                Azure Portal → App Registrations
              </a>
              , click <strong>New registration</strong>
            </li>
            <li>Supported account types: <strong>Accounts in any organizational directory and personal Microsoft accounts</strong></li>
            <li>Redirect URI (Web): <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{'https://<your-api-domain>/api/analytics/callback/microsoft'}</code></li>
            <li>After registration, go to <strong>Certificates & secrets → New client secret</strong>, copy the <strong>Value</strong> (not the Secret ID)</li>
            <li>
              Go to <strong>Manifest</strong> and verify:
              <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                <li><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{'"signInAudience": "AzureADandPersonalMicrosoftAccount"'}</code></li>
                <li><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{'"accessTokenAcceptedVersion": 2'}</code></li>
              </ul>
            </li>
            <li>The <code className="rounded bg-muted px-1.5 py-0.5 text-xs">MICROSOFT_CLIENT_ID</code> is the <code className="rounded bg-muted px-1.5 py-0.5 text-xs">appId</code> from the Overview page or manifest</li>
          </ol>
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
