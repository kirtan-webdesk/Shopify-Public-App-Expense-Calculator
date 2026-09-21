// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "build/**",
      ".react-router/**",
      "node_modules/**",
      "app/.gates/**",
      "db/migrations/**",
      "projects/**",
      "design/**",
      ".claude/**",
      // Delivery evidence (screenshots, MCP records, gate logs) and the scratch
      // scripts that produced it (dev-evidence/**/tools/*.mjs use Node/browser
      // globals such as process/console/document) are not app source.
      "dev-evidence/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Applies to every linted file (JS/CJS/TS/TSX). Core ESLint rules only —
    // no plugin-specific rule here, so it is safe regardless of which
    // parser/plugin set is active for a given file extension.
    rules: {
      // ADR-0006 / FT-10: REST is prohibited for new public apps (Req 2.2.4).
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='rest']",
          message:
            "admin.rest is prohibited (Req 2.2.4) — use Admin GraphQL, and " +
            "confirm any new Admin call against ADR-0006 (scopes: []) first.",
        },
      ],
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // FT-01 approximation (ADR-0003): repositories are the sole place
      // Sequelize models are touched. This is a lightweight guardrail, not
      // the full dependency-cruiser/eslint-plugin-boundaries fitness test
      // decisions/fitness-test-plan.md describes (FT-01 is explicit M1/G5
      // fitness-test-suite work, tracked separately — see the developer
      // handoff). It still catches the most common mistake: a route or
      // service importing a Sequelize model directly.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/db/models/*", "**/db/models"],
              // Value imports of a Sequelize model are what ADR-0003 bans
              // outside the repository layer; a type-only import (e.g. a
              // union type re-exported from a model file) doesn't touch the
              // ORM and is allowed.
              allowTypeImports: true,
              message:
                "Only app/db/repositories/* may import app/db/models/* (ADR-0003). " +
                "Add or use a repository function instead.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["app/db/repositories/**/*.ts", "app/db/models/**/*.ts"],
    rules: {
      // The repository/model layers are explicitly allowed to import
      // models — they are the one place ADR-0003 designates for it.
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        process: "readonly",
        // Added for db/config/config.cjs's DIRECT_DATABASE_URL fallback
        // warning (ADR-0010 point 5) — the previous globals list only
        // covered what the file needed before that warning existed.
        console: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
