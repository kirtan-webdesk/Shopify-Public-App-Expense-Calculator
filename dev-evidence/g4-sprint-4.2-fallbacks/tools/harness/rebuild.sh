#!/bin/sh
# Rebuild the hydrated harness (SSR bundle + client bundle) from the current app code.
cd "D:/Projects/Shopify Public App — Expense Calculator"
export APP_ROOT="D:/Projects/Shopify Public App — Expense Calculator" LABEL=${LABEL:-after}
H=dev-evidence/g4-sprint-4.2-fallbacks/tools/harness
SSR=1 npx vite build --config $H/vite.hydrate.mjs 2>&1 | grep -v "use client" ; SSR=0 npx vite build --config $H/vite.hydrate.mjs 2>&1 | grep -v "use client"
