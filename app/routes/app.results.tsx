// --------------------------------------------------------------------------
// /app/results — M1 SCAFFOLD PAGE.
//
// Structural placeholder for design/mockup/results.html (G2-confirmed).
// The real results view — the accessible data table as primary
// representation plus the hand-rolled inline SVG donut (ADR-0004), reading
// from a real calculation engine output — is M3 scope (D7, D8, D9) and is
// NOT built here. The G2 mockup's dev-only fixture-data-swap dropdown is
// intentionally NOT ported (it was explicitly flagged non-shippable at G2
// and must be stripped before any real port of this page's markup).
//
// The mockup's `backAction="./calculator.html"` attribute does NOT exist on
// the real <s-page> component (verified against the Dev MCP polaris-app-home
// docs at build time — DESIGN-NOTES.md §7 had already flagged this as
// verify-at-build). The real pattern is an <s-link slot="breadcrumb-actions">
// child.
// --------------------------------------------------------------------------

export default function ResultsPage() {
  return (
    <s-page heading="Results">
      <s-link slot="breadcrumb-actions" href="/app/calculator">
        Calculator
      </s-link>
      <s-section>
        <s-banner tone="info" heading="Results view — M3 scope">
          <p>
            The calculation engine (D7), results table, and donut chart
            (D8/D9, ADR-0004) are not yet built. This route exists to prove
            the App Bridge/Polaris/navigation shell renders correctly at this
            path.
          </p>
        </s-banner>
      </s-section>
    </s-page>
  );
}
