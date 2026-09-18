// The three expense-rule shapes (spec.md D6). Canonical definition lives in
// the domain layer (pure, no DB dependency) — app/db/models/expense-rule.model.ts
// and app/db/models/calculation-line-item.model.ts import this instead of
// each other, so the domain layer never depends on Sequelize.
export type RuleType = "percentage" | "fixed" | "formula";

export const RULE_TYPES: readonly RuleType[] = ["percentage", "fixed", "formula"];

export function isRuleType(value: string): value is RuleType {
  return (RULE_TYPES as readonly string[]).includes(value);
}
