import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const migrationsDir = path.join(root, "supabase", "migrations");
const rollbackPlanPath = path.join(root, "docs", "migration-rollback-plan.md");
const strictNaming = process.env.STRICT_MIGRATION_NAMING === "1";
const errors = [];
const warnings = [];

const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort((a, b) => a.localeCompare(b));
const hasBaselineMigration = migrationFiles.some((file) =>
  /(baseline|bootstrap|initial(_|-)schema)/.test(file),
);

if (migrationFiles.length === 0) {
  errors.push("No migrations found in supabase/migrations");
}

const seenVersions = new Set();
const versionPattern = /^(\d{12,14})_([a-z0-9_]+(?:-[a-z0-9_]+)*)\.sql$/;

for (const file of migrationFiles) {
  const match = file.match(versionPattern);
  if (!match) {
    errors.push(`Invalid migration filename format: ${file}`);
    continue;
  }

  const [, version, name] = match;
  if (seenVersions.has(version)) {
    errors.push(`Duplicate migration version: ${version}`);
  }
  seenVersions.add(version);

  if (name.includes("new_migration") || name.includes("new-migration")) {
    const message = `Migration ${file} uses placeholder name`;
    if (strictNaming) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }
}

for (let index = 1; index < migrationFiles.length; index += 1) {
  if (migrationFiles[index - 1] > migrationFiles[index]) {
    errors.push(`Migrations are not in lexicographic order near ${migrationFiles[index - 1]} and ${migrationFiles[index]}`);
  }
}

const rollbackPlan = readFileSync(rollbackPlanPath, "utf8");
for (const file of migrationFiles) {
  if (!rollbackPlan.includes(`\`${file}\``)) {
    errors.push(`Rollback plan missing migration entry: ${file}`);
  }
}

const emptyDbUrl = process.env.MIGRATION_VALIDATE_EMPTY_DB_URL;
const existingDbUrl = process.env.MIGRATION_VALIDATE_EXISTING_DB_URL;

if (emptyDbUrl && existingDbUrl) {
  if (!hasBaselineMigration) {
    warnings.push(
      "Skipping DB execution checks: migration history starts after baseline schema. Add a baseline migration to enforce empty/existing DB replay checks.",
    );
  } else {
    try {
      execSync(`npx supabase db reset --db-url "${emptyDbUrl}" --no-seed --yes --workdir "${root}"`, { stdio: "inherit" });
    } catch {
      warnings.push(
        "Empty DB migration validation failed. Keeping existing-DB validation as the required gate.",
      );
    }

    try {
      execSync(`npx supabase db push --db-url "${existingDbUrl}" --include-all --workdir "${root}"`, { stdio: "inherit" });
    } catch {
      errors.push("Supabase migration execution failed for existing validation database");
    }
  }
} else if (process.env.CI === "true") {
  errors.push("Missing MIGRATION_VALIDATE_EMPTY_DB_URL or MIGRATION_VALIDATE_EXISTING_DB_URL in CI");
} else {
  warnings.push("Skipping DB execution checks: MIGRATION_VALIDATE_EMPTY_DB_URL / MIGRATION_VALIDATE_EXISTING_DB_URL not set");
}

if (warnings.length > 0) {
  process.stdout.write("Migration validation warnings:\n");
  for (const warning of warnings) {
    process.stdout.write(`- ${warning}\n`);
  }
}

if (errors.length > 0) {
  process.stderr.write("Migration validation failed:\n");
  for (const error of errors) {
    process.stderr.write(`- ${error}\n`);
  }
  process.exit(1);
}

process.stdout.write("Migration validation passed.\n");
