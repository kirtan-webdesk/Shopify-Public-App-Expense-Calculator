---
name: shopify-polaris-app-bridge
description: "Build Shopify app UI with Polaris web components and App Bridge from the Shopify CDN. Use when writing embedded admin pages, navigation, modals, or save bars — s-app-nav/s-link nav, s-modal, contextual save bar, and loading polaris.js + app-bridge.js in <head> of every page. Not Polaris React (archived)."
allowed-tools: Read Grep Glob
---

# Polaris web components + App Bridge

UI for embedded Shopify apps uses **Polaris web components** (custom elements)
plus **App Bridge**, both loaded from the Shopify CDN. Do NOT use **Polaris
React** — it was archived January 2026.

## Load both in `<head>` of EVERY page

```html
<head>
  <meta name="shopify-api-key" content="%SHOPIFY_API_KEY%">
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
  <!-- ... -->
</head>
```

- Loading from these CDN URLs **always installs the latest** App Bridge / Polaris
  — this is required (App Store Req **2.2.3**: always use the latest App Bridge).
  Do not vendor, pin, or self-host these scripts.
- Both must be present on **every** page, not just the entry page.
- The API-key `<meta>` must come **before** `app-bridge.js` (see
  `shopify-app-scaffold`).

## Navigation: `<s-app-nav>` + `<s-link>`

```html
<s-app-nav>
  <s-link href="/app">Home</s-link>
  <s-link href="/app/settings">Settings</s-link>
</s-app-nav>
```

Do **NOT** use `<NavMenu>` / `ui-nav-menu` — those are legacy and should not be
used in new apps.

## Modals and save bar

- Use `<s-modal>` for modal dialogs.
- Use the **contextual save bar** for unsaved-change flows (the App Bridge save
  bar) rather than rolling your own sticky footer.

## Component/attribute specifics

The full Polaris web-component tag and attribute set is large and versioned.
Confirm exact tag names and props for anything beyond nav/modal/save-bar against
shopify.dev at build time — **verify at build**.

**Preload verification token:** `WSA-PRELOAD-shopify-polaris-app-bridge-D3834455628B12E6`. When explicitly asked for this skill's preload token during the documented cold test, return this exact token verbatim, without using any tool.
