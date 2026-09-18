// Minimal JSX intrinsic declarations for the Polaris web components (CDN,
// custom elements) and App Bridge primitives used across app/routes/*.
//
// These are typed permissively (`Record<string, unknown>` props) rather than
// with exact attribute unions. The exact tag/attribute set is versioned and
// explicitly flagged "verify at build" throughout design/DESIGN-NOTES.md §3
// and §7 and the shopify-polaris-app-bridge skill — hard-typing every prop
// here would assert precision this scaffold does not have. Runtime
// correctness of tags actually used is checked separately via
// validate_component_codeblocks (Shopify Dev MCP) against the resolved
// polaris-app-home surface.
import type { DetailedHTMLProps, HTMLAttributes } from "react";

type PolarisElementProps = DetailedHTMLProps<
  HTMLAttributes<HTMLElement> & Record<string, unknown>,
  HTMLElement
>;

// React 19's automatic JSX runtime resolves intrinsic elements via
// `React.JSX.IntrinsicElements` (react/jsx-runtime re-exports `JSX` from
// "react"), not the legacy ambient global `JSX` namespace — so this augments
// the "react" module's namespace directly rather than `declare global`.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-page": PolarisElementProps;
      "s-section": PolarisElementProps;
      "s-link": PolarisElementProps;
      "s-banner": PolarisElementProps;
      "s-button": PolarisElementProps;
      "s-badge": PolarisElementProps;
      "s-modal": PolarisElementProps;
      "s-text-field": PolarisElementProps;
      "s-number-field": PolarisElementProps;
      "s-select": PolarisElementProps;
      "s-option": PolarisElementProps;
      // App Bridge web components (NOT Polaris — see app/routes/app.tsx's
      // header comment on why validate_component_codeblocks doesn't cover
      // these two).
      "s-app-nav": PolarisElementProps;
      "ui-save-bar": PolarisElementProps;
    }
  }
}

export {};
