import { readFileSync } from "node:fs";

const schemaPath = "supabase/schema.sql";
const schema = readFileSync(schemaPath, "utf8");
const lines = schema.split(/\r?\n/);

const createTableLine = new Map();
const createTableColumns = new Map();
const tableCreateCount = new Map();
const functionLine = new Map();
const functionCreateCount = new Map();
const policyActive = new Map();
const rlsEnabledTables = new Set();
const errors = [];
const createTableRegex = /^\s*create table if not exists public\.([a-z0-9_]+)\s*\(/i;
const createFunctionRegex =
  /^\s*create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(([^)]*)\)/i;
const createPolicyRegex =
  /^\s*create\s+policy\s+"([^"]+)"\s+on\s+public\.([a-z0-9_]+)\s+/i;
const dropPolicyRegex =
  /^\s*drop\s+policy\s+if\s+exists\s+"([^"]+)"\s+on\s+public\.([a-z0-9_]+)\s*;/i;
const alterAddColumnRegex =
  /^\s*alter table public\.([a-z0-9_]+)\s+add column if not exists\s+/i;
const enableRlsRegex =
  /^\s*alter table public\.([a-z0-9_]+)\s+enable row level security\s*;/i;

let currentTable = null;
lines.forEach((line, index) => {
  if (currentTable) {
    if (/^\s*\)\s*;/.test(line)) {
      currentTable = null;
    } else {
      const columnMatch = line.match(/^\s*([a-z_][a-z0-9_]*)\s+/i);
      if (columnMatch) {
        const token = columnMatch[1].toLowerCase();
        if (
          !["constraint", "primary", "foreign", "unique", "check"].includes(token)
        ) {
          createTableColumns.get(currentTable).add(token);
        }
      }
    }
  }

  const tableMatch = line.match(createTableRegex);
  if (tableMatch) {
    const tableName = tableMatch[1].toLowerCase();
    tableCreateCount.set(tableName, (tableCreateCount.get(tableName) ?? 0) + 1);
    if (!createTableLine.has(tableName)) {
      createTableLine.set(tableName, index + 1);
    }
    if (!createTableColumns.has(tableName)) {
      createTableColumns.set(tableName, new Set());
    }
    currentTable = tableName;
  }

  const functionMatch = line.match(createFunctionRegex);
  if (functionMatch) {
    const signature = `${functionMatch[1]}(${functionMatch[2].replace(/\s+/g, " ").trim()})`;
    functionCreateCount.set(signature, (functionCreateCount.get(signature) ?? 0) + 1);
    if (!functionLine.has(signature)) {
      functionLine.set(signature, index + 1);
    }
  }
  const dropPolicyMatch = line.match(dropPolicyRegex);
  if (dropPolicyMatch) {
    const key = `${dropPolicyMatch[2]}.${dropPolicyMatch[1]}`;
    policyActive.set(key, false);
  }

  const createPolicyMatch = line.match(createPolicyRegex);
  if (createPolicyMatch) {
    const key = `${createPolicyMatch[2]}.${createPolicyMatch[1]}`;
    if (policyActive.get(key)) {
      errors.push(
        `${schemaPath}:${index + 1} duplicate active policy definition for "${key}" without drop policy before recreate`,
      );
    }
    policyActive.set(key, true);
  }

  const enableRlsMatch = line.match(enableRlsRegex);
  if (enableRlsMatch) {
    rlsEnabledTables.add(enableRlsMatch[1].toLowerCase());
  }
});

const forbiddenGlobalAnonGrants = [
  /grant\s+select\s+on\s+all\s+tables\s+in\s+schema\s+public\s+to\s+anon\s*;/i,
  /alter\s+default\s+privileges\s+in\s+schema\s+public\s+grant\s+select\s+on\s+tables\s+to\s+anon\s*;/i,
];

lines.forEach((line, index) => {
  for (const pattern of forbiddenGlobalAnonGrants) {
    if (pattern.test(line)) {
      errors.push(
        `${schemaPath}:${index + 1} forbidden broad anon grant detected: "${line.trim()}"`,
      );
    }
  }
});

for (const [tableName, count] of tableCreateCount.entries()) {
  if (count > 1) {
    errors.push(
      `${schemaPath}:${createTableLine.get(tableName)} duplicate create table for "${tableName}" (${count} times)`,
    );
  }
}

for (const [signature, count] of functionCreateCount.entries()) {
  if (count > 1) {
    errors.push(
      `${schemaPath}:${functionLine.get(signature)} duplicate function definition for "${signature}" (${count} times)`,
    );
  }
}

for (const tableName of tableCreateCount.keys()) {
  if (!rlsEnabledTables.has(tableName)) {
    errors.push(
      `${schemaPath}:${createTableLine.get(tableName)} missing "alter table public.${tableName} enable row level security;"`,
    );
  }
}

lines.forEach((line, index) => {
  const match = line.match(alterAddColumnRegex);
  if (!match) {
    return;
  }

  const tableName = match[1].toLowerCase();
  const alterLine = index + 1;
  const createLine = createTableLine.get(tableName);
  const columnMatch = line.match(
    /^\s*alter table public\.[a-z0-9_]+\s+add column if not exists\s+([a-z_][a-z0-9_]*)\s+/i,
  );

  if (!createLine) {
    errors.push(
      `${schemaPath}:${alterLine} alter table on "${tableName}" has no matching create table in this file`,
    );
    return;
  }

  if (alterLine < createLine) {
    errors.push(
      `${schemaPath}:${alterLine} alter table on "${tableName}" appears before create table at line ${createLine}`,
    );
  }

  if (columnMatch) {
    const columnName = columnMatch[1].toLowerCase();
    const knownColumns = createTableColumns.get(tableName);
    if (knownColumns?.has(columnName)) {
      errors.push(
        `${schemaPath}:${alterLine} redundant add column "${tableName}.${columnName}" because it already exists in create table`,
      );
    }
  }
});

if (errors.length > 0) {
  process.stderr.write("Schema check failed:\n");
  errors.forEach((error) => process.stderr.write(`- ${error}\n`));
  process.exit(1);
}

process.stdout.write("Schema check passed.\n");
