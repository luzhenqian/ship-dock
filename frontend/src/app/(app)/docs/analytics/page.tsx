'use client';

export default function AnalyticsDocsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10 py-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Analytics Integration</h1>
        <p className="text-muted-foreground mt-2">
          Centrally manage Google Analytics (GA4) and Microsoft Clarity tracking across all your projects.
        </p>
      </div>

      {/* Overview */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">Overview</h2>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Ship Dock's Analytics Integration lets you connect your Google and Microsoft accounts once, then associate GA4 properties or Clarity projects with any of your deployed projects. For GA4, you can also build custom reports with charts directly in the platform. For Clarity, you can manage projects and jump to the Clarity dashboard.
        </p>
        <div className="grid gap-3 md:grid-cols-2 text-sm">
          <div className="rounded-lg border p-4 space-y-1">
            <p className="font-medium">Google Analytics (GA4)</p>
            <p className="text-muted-foreground">Full integration — create properties, manage data streams, view custom reports with charts</p>
          </div>
          <div className="rounded-lg border p-4 space-y-1">
            <p className="font-medium">Microsoft Clarity</p>
            <p className="text-muted-foreground">Lightweight — create and link projects, view data via Clarity dashboard</p>
          </div>
        </div>
      </section>

      {/* Step 1 */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">Step 1: Connect Your Account</h2>
        <ol className="list-decimal list-inside space-y-2 text-sm text-foreground/80">
          <li>Go to <strong>Settings → Integrations</strong> from the top navigation</li>
          <li>Click <strong>Connect Google Account</strong> or <strong>Connect Microsoft Account</strong></li>
          <li>You will be redirected to Google / Microsoft to authorize access</li>
          <li>After authorizing, you'll be redirected back to Ship Dock</li>
          <li>Your connected account will appear as a card with the authorized email</li>
        </ol>
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <strong>Note:</strong> You can connect multiple accounts (e.g., personal + work Google accounts). Each connection is tied to your Ship Dock user account, and all your projects can use any of your connected accounts.
        </div>
      </section>

      {/* Step 2 */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">Step 2: Set Up Analytics for a Project</h2>
        <ol className="list-decimal list-inside space-y-2 text-sm text-foreground/80">
          <li>Navigate to your project and click <strong>Analytics</strong> in the sidebar</li>
          <li>Click <strong>Set Up Integration</strong></li>
          <li>Choose a provider: <strong>Google Analytics (GA4)</strong> or <strong>Microsoft Clarity</strong></li>
          <li>Select one of your connected accounts</li>
          <li>
            For <strong>GA4</strong>: choose an existing property or create a new one, then select a data stream
          </li>
          <li>
            For <strong>Clarity</strong>: choose an existing project or create a new one
          </li>
          <li>Click <strong>Confirm</strong> to complete the setup</li>
        </ol>
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <strong>Tip:</strong> Each project can have one GA4 integration and one Clarity integration at the same time.
        </div>
      </section>

      {/* Step 3 */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">Step 3: View GA4 Reports</h2>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Once GA4 is set up for a project, click <strong>View Reports</strong> on the analytics overview page to open the report builder.
        </p>
        <div className="space-y-2 text-sm text-foreground/80">
          <p className="font-medium text-foreground">Using the Report Builder:</p>
          <ol className="list-decimal list-inside space-y-2">
            <li><strong>Date Range</strong> — Select a preset (7 days, 30 days, 90 days) or set a custom range</li>
            <li><strong>Dimensions</strong> — Click to toggle dimensions like Date, Country, Device, Browser, Page Path, etc.</li>
            <li><strong>Metrics</strong> — Click to toggle metrics like Active Users, Page Views, Sessions, Bounce Rate, etc.</li>
            <li>Click <strong>Run Report</strong></li>
          </ol>
        </div>
        <div className="space-y-2 text-sm text-foreground/80">
          <p className="font-medium text-foreground">Chart Types (auto-selected):</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Line chart</strong> — when "Date" is selected as a dimension (time series)</li>
            <li><strong>Pie chart</strong> — when a single non-date dimension is selected (e.g., Country)</li>
            <li><strong>Bar chart</strong> — for all other dimension combinations</li>
          </ul>
        </div>
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <strong>Note:</strong> Reports are cached for 5 minutes. Real-time data refreshes every 30 seconds.
        </div>
      </section>

      {/* Clarity */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">Viewing Clarity Data</h2>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Microsoft Clarity does not provide a public API for viewing analytics data (heatmaps, session recordings, etc.). After linking a Clarity project, click <strong>Open Clarity Dashboard</strong> on the analytics overview page to view your data directly in the Clarity web interface.
        </p>
      </section>

      {/* Managing */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">Managing Integrations</h2>
        <div className="space-y-2 text-sm text-foreground/80">
          <p className="font-medium text-foreground">Remove a project integration:</p>
          <p>Go to your project's <strong>Analytics</strong> page and click <strong>Remove</strong> on the integration card.</p>
        </div>
        <div className="space-y-2 text-sm text-foreground/80">
          <p className="font-medium text-foreground">Disconnect an account:</p>
          <p>Go to <strong>Settings → Integrations</strong> and click <strong>Disconnect</strong> on the account card. This will also remove all project integrations using that account.</p>
        </div>
      </section>

      {/* Permissions */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">Permissions</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4 text-left font-medium">Action</th>
                <th className="py-2 pr-4 text-left font-medium">Required Role</th>
              </tr>
            </thead>
            <tbody className="text-foreground/80">
              <tr className="border-b">
                <td className="py-2 pr-4">View analytics & reports</td>
                <td className="py-2 pr-4">Viewer</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">Set up / remove integrations</td>
                <td className="py-2 pr-4">Admin</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">Connect / disconnect accounts</td>
                <td className="py-2 pr-4">Any (own account only)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b pb-2">FAQ</h2>
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-medium text-foreground">Can I use an existing GA4 property?</p>
            <p className="text-foreground/80">Yes. During setup, all properties under your Google account are listed. You can select an existing one or create a new one.</p>
          </div>
          <div>
            <p className="font-medium text-foreground">What happens if my token expires?</p>
            <p className="text-foreground/80">Google tokens are refreshed automatically. If a refresh fails, you'll see an "Expired" badge on the connection card — just reconnect the account.</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Can different projects use different Google accounts?</p>
            <p className="text-foreground/80">Yes. Connect multiple accounts in Settings → Integrations, then choose which account to use when setting up each project.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
