// --------------------------------------------------------------------------
// /app/history/:id — M1 SCAFFOLD PAGE.
//
// Structural placeholder for design/mockup/history-detail.html
// (G2-confirmed). Rendering a saved calculation's frozen snapshot (D11) is
// M4 scope and is NOT wired to a loader here.
//
// backAction is not a real <s-page> prop (verified against the Dev MCP
// polaris-app-home docs) — uses the real breadcrumb-actions slot pattern.
// --------------------------------------------------------------------------

export default function HistoryDetailPage() {
  return (
    <s-page heading="Saved calculation">
      <s-link slot="breadcrumb-actions" href="/app/history">
        History
      </s-link>
      <s-section>
        <s-banner tone="info" heading="Saved-calculation detail — M4 scope">
          <p>
            Rendering a saved calculation&apos;s frozen snapshot (D11) is not
            yet built. This route exists to prove the App Bridge/Polaris/
            navigation shell renders correctly at this path.
          </p>
        </s-banner>
      </s-section>
    </s-page>
  );
}
