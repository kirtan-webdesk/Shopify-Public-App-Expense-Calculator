// --------------------------------------------------------------------------
// /app/history/:id — M1 SCAFFOLD PAGE.
//
// Structural placeholder for design/mockup/history-detail.html
// (G2-confirmed). Rendering a saved calculation's frozen snapshot (D11) is
// M4 scope and is NOT wired to a loader here.
// --------------------------------------------------------------------------

export default function HistoryDetailPage() {
  return (
    <s-page heading="Saved calculation" backAction="/app/history">
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
