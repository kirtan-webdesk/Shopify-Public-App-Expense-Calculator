// ShopContext — the mandatory first argument to every repository function
// (ADR-0003). Never a plain string pulled from a request parameter, a query
// string, or a form field: it must come from `authenticate.admin` (embedded
// routes) or from the verified webhook `shop` domain (webhook routes).
//
// This type intentionally carries only what tenancy needs. It is NOT a
// session object and NOT a place to smuggle other request state through.
export interface ShopContext {
  readonly shopId: string;
  readonly shopDomain: string;
}

export function createShopContext(shopId: string, shopDomain: string): ShopContext {
  if (!shopId || !shopDomain) {
    throw new Error(
      "createShopContext requires both a resolved shopId and shopDomain — " +
        "never construct a partial ShopContext.",
    );
  }
  return { shopId, shopDomain };
}
