import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const schemaPath = path.join(root, "supabase", "schema.sql");
const migrationsDir = path.join(root, "supabase", "migrations");
const anonAllowlistPath = path.join(root, "supabase", "security", "anon-select-allowlist.json");

const sqlFiles = [schemaPath];
for (const name of readdirSync(migrationsDir)) {
  if (name.endsWith(".sql")) {
    sqlFiles.push(path.join(migrationsDir, name));
  }
}

const anonAllowlist = new Set(
  JSON.parse(readFileSync(anonAllowlistPath, "utf8")).map((value) => String(value).toLowerCase()),
);

const errors = [];
const anonGrantedTables = new Set();
const rlsTables = new Set();
const selectPolicyTables = new Set();
const storagePublicBuckets = new Set();
const storagePrivateBuckets = new Set();
const storageReadPolicies = new Set();

const publicBucketAllowlist = new Set(["avatars", "banners", "posts", "reels", "stories", "clips"]);
const privateBucketRequired = "chat";

for (const filePath of sqlFiles) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  let insideStorageBucketsInsert = false;
  let policyTable = null;
  let policyStatement = "";

  lines.forEach((line, index) => {
    const lineNo = index + 1;

    if (/grant\s+select\s+on\s+all\s+tables\s+in\s+schema\s+public\s+to\s+anon\s*;/i.test(line)) {
      errors.push(`${filePath}:${lineNo} broad anon grant detected`);
    }

    const grantAnonMatch = line.match(/grant\s+select\s+on\s+public\.([a-z0-9_]+)\s+to\s+anon\b/i);
    if (grantAnonMatch) {
      anonGrantedTables.add(grantAnonMatch[1].toLowerCase());
    }

    const rlsMatch = line.match(/alter\s+table\s+public\.([a-z0-9_]+)\s+enable\s+row\s+level\s+security\s*;/i);
    if (rlsMatch) {
      rlsTables.add(rlsMatch[1].toLowerCase());
    }

    const policyStartMatch = line.match(/create\s+policy\s+"[^"]+"\s+on\s+public\.([a-z0-9_]+)\b/i);
    if (policyStartMatch) {
      policyTable = policyStartMatch[1].toLowerCase();
      policyStatement = line;
    } else if (policyTable) {
      policyStatement += ` ${line}`;
    }

    if (policyTable && line.includes(";")) {
      if (/for\s+(select|all)\b/i.test(policyStatement)) {
        selectPolicyTables.add(policyTable);
      }
      policyTable = null;
      policyStatement = "";
    }

    if (/insert\s+into\s+storage\.buckets\b/i.test(line)) {
      insideStorageBucketsInsert = true;
    }

    if (insideStorageBucketsInsert) {
      const bucketValueMatch = line.match(/\(\s*'([a-z0-9_]+)'\s*,\s*'[^']+'\s*,\s*(true|false)\s*\)/i);
      if (bucketValueMatch) {
        const bucket = bucketValueMatch[1].toLowerCase();
        const isPublic = bucketValueMatch[2].toLowerCase() === "true";
        if (isPublic) {
          storagePublicBuckets.add(bucket);
        } else {
          storagePrivateBuckets.add(bucket);
        }
      }

      if (line.includes(";")) {
        insideStorageBucketsInsert = false;
      }
    }

    const storageReadPolicyMatch = line.match(
      /create\s+policy\s+"[^"]+"\s+on\s+storage\.objects\s+for\s+select\s+using\s+\(\s*bucket_id\s*=\s*'([a-z0-9_]+)'/i,
    );
    if (storageReadPolicyMatch) {
      storageReadPolicies.add(storageReadPolicyMatch[1].toLowerCase());
    }
  });
}

for (const table of anonGrantedTables) {
  if (!anonAllowlist.has(table)) {
    errors.push(`anon grant for public.${table} is not in ${path.relative(root, anonAllowlistPath)}`);
  }
  if (!rlsTables.has(table)) {
    errors.push(`anon grant for public.${table} without RLS enabled`);
  }
  if (!selectPolicyTables.has(table)) {
    errors.push(`anon grant for public.${table} without SELECT policy`);
  }
}

for (const table of anonAllowlist) {
  if (!anonGrantedTables.has(table)) {
    errors.push(`allowlist table public.${table} has no anon SELECT grant`);
  }
}

if (!storagePrivateBuckets.has(privateBucketRequired)) {
  errors.push(`storage bucket "${privateBucketRequired}" must remain private`);
}

for (const bucket of storagePublicBuckets) {
  if (!publicBucketAllowlist.has(bucket)) {
    errors.push(`storage bucket "${bucket}" is public but not allowlisted`);
  }
}

for (const bucket of publicBucketAllowlist) {
  if (!storagePublicBuckets.has(bucket)) {
    errors.push(`expected public storage bucket "${bucket}" missing`);
  }
  if (!storageReadPolicies.has(bucket)) {
    errors.push(`expected public read policy for bucket "${bucket}" missing`);
  }
}

if (storageReadPolicies.has(privateBucketRequired)) {
  errors.push(`private bucket "${privateBucketRequired}" must not have a public read policy`);
}

if (errors.length > 0) {
  process.stderr.write("Security audit failed:\n");
  for (const error of errors) {
    process.stderr.write(`- ${error}\n`);
  }
  process.exit(1);
}

process.stdout.write("Security audit passed.\n");
