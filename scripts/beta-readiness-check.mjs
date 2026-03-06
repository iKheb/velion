import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredPaths = [
  ".github/workflows/ci.yml",
  ".github/workflows/release-readiness.yml",
  "docs/beta-public-checklist.md",
  "docs/release-runbook.md",
  "docs/incident-runbook.md",
  "docs/observability-baseline.md",
  "docs/moderation-operations.md",
  "docs/legal-readiness.md",
  "docs/feature-flags.md",
  "docs/migration-rollback-plan.md",
  "supabase/seed.sql",
  "src/config/feature-flags.ts",
];

const errors = [];
for (const relativePath of requiredPaths) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    errors.push(`Missing required beta artifact: ${relativePath}`);
  }
}

const envExamplePath = path.join(root, ".env.example");
if (existsSync(envExamplePath)) {
  const envExample = readFileSync(envExamplePath, "utf8");
  for (const requiredVar of ["VITE_SENTRY_DSN", "VITE_CLIENT_LOG_ENDPOINT", "VITE_FF_STREAMS", "VITE_FF_WALLET", "VITE_FF_MODERATION", "VITE_FF_SEARCH", "VITE_FF_SUPPORT"]) {
    if (!envExample.includes(`${requiredVar}=`)) {
      errors.push(`.env.example missing ${requiredVar}`);
    }
  }
}

if (errors.length > 0) {
  process.stderr.write("Beta readiness artifact check failed:\n");
  for (const error of errors) {
    process.stderr.write(`- ${error}\n`);
  }
  process.exit(1);
}

process.stdout.write("Beta readiness artifact check passed.\n");
