# G3 Developer Handoff — expense-calculator scaffold + M1 Foundation

Commit: `299328cd2288c7fbcef4511a41be6f2ee160988b`
MCP-Evidence: dev-evidence/g3-scaffold/mcp-validation-evidence.json

Built the React Router 7 + `@shopify/shopify-app-react-router` scaffold plus
Milestone 1 "Foundation" (auth, session storage, tenancy repository layer,
compliance webhooks, initial migration) per the confirmed architecture (8
ADRs), G-Schema data model, and G2 mockups. Lint, typecheck, test, and build
all pass for real. Shopify Dev MCP validation ran for the Polaris/App Bridge
UI surface; GraphQL validation was not needed because the app makes zero
Admin GraphQL calls (ADR-0006, asserted by a static test).

Everything below is either a normal handoff note or an explicit flag per the
no-silent-decisions rule. See `mcp-validation-evidence.json`'s
`remaining_warnings` / `live_store_items` for the machine-readable version of
the same list.
