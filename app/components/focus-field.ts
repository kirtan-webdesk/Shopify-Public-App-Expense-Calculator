/**
 * Moves keyboard focus to a Polaris field by element id. The s-* fields are custom
 * elements whose real <input>/<select> lives in a shadow root, and `focus()` on the host
 * does not always reach it, so fall back to the first focusable control inside the shadow
 * root (measured in Chromium, G4-sprint-4.1: host.focus() left focus on the previous element).
 */
export function focusField(id: string): void {
  const host = document.getElementById(id);
  if (!host) return;
  const inner = host.shadowRoot?.querySelector<HTMLElement>("input, select, textarea, button");
  (inner ?? host).focus();
}
