import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Approximates FT-01 (ADR-0003): only app/db/repositories/* (and
// app/db/models/* itself) may import app/db/models/*. Routes, services, and
// workers go through repositories.

const APP_DIR = join(process.cwd(), "app");
const ALLOWED_DIRS = [join("app", "db", "repositories"), join("app", "db", "models")];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) {
      out.push(full);
    }
  }
  return out;
}

// A VALUE import of a Sequelize model is what ADR-0003 bans outside the
// repository/model layers. `import type { Foo } from ".../db/models/..."`
// is a type-only import — it never touches the ORM — and is allowed, same
// exemption as eslint.config.js's no-restricted-imports allowTypeImports.
const MODEL_IMPORT_PATTERN = /^(?!.*\bimport type\b).*from\s+["'].*db\/models[^"']*["']/m;

describe("repository-layer import boundary (FT-01 approximation)", () => {
  const files = walk(APP_DIR);

  it.each(files.map((f) => [relative(process.cwd(), f), f] as const))(
    "%s does not import app/db/models unless it is a repository or model file itself",
    (relPath, absPath) => {
      const isAllowed = ALLOWED_DIRS.some((d) => relPath.startsWith(d + sep) || relPath === d);
      const source = readFileSync(absPath, "utf8");
      const importsModels = MODEL_IMPORT_PATTERN.test(source);

      if (importsModels) {
        expect(
          isAllowed,
          `${relPath} imports app/db/models directly — only app/db/repositories/* ` +
            "(ADR-0003) or app/db/models/* itself may do this.",
        ).toBe(true);
      }
    },
  );
});
