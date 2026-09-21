export const authenticate = {
  admin: async (_r: Request) => {
    await new Promise((r) => setTimeout(r, (globalThis as any).__delay || 0));
    return { session: { shop: "harness.myshopify.com" } };
  },
};
