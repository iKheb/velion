import { execSync } from "node:child_process";

const hasCredentials = Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);
const isCi = process.env.CI === "true";

if (!hasCredentials) {
  if (isCi) {
    process.stderr.write("E2E credentials missing in CI: set E2E_EMAIL and E2E_PASSWORD.\n");
    process.exit(1);
  }
  process.stdout.write("Skipping E2E locally: missing E2E_EMAIL/E2E_PASSWORD.\n");
  process.exit(0);
}

execSync("npx playwright install chromium", { stdio: "inherit" });
execSync("npx playwright test", { stdio: "inherit" });
