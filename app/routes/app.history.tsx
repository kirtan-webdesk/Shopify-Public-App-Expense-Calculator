// --------------------------------------------------------------------------
// /app/history — M1 SCAFFOLD PAGE.
//
// Structural placeholder for design/mockup/history.html (G2-confirmed). The
// save/history feature (D10, D11) — listing real saved calculations from the
// `calculation` table via app/db/repositories/calculation.repository.ts —
// is M4 scope and is NOT wired to a loader here.
// --------------------------------------------------------------------------

export default function HistoryPage() {
  return (
    <s-page heading="History">
      <s-section heading="Saved calculations">
        <s-banner tone="info" heading="History view — M4 scope">
          <p>
            Save + history (D10, D11) are not yet built. This route exists to
            prove the App Bridge/Polaris/navigation shell renders correctly
            at this path; the repository layer it will read from
            (calculation.repository.ts) already exists per ADR-0003.
          </p>
        </s-banner>
      </s-section>
    </s-page>
  );
}
