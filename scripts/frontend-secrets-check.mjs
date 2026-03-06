import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const targetPaths = [
  "src",
  "public",
  "index.html",
  ".env",
  ".env.example",
  "vite.config.ts",
];

const forbiddenPatterns = [
  /SUPABASE_SERVICE_ROLE_KEY/g,
  /VITE_SUPABASE_SERVICE_ROLE/gi,
  /SUPABASE_SERVICE_ROLE/gi,
  /service_role\s*[:=]/gi,
];

const ignoredDirs = new Set(["node_modules", "dist", ".git"]);
const ignoredExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".mp4", ".mp3"]);
const errors = [];

const collectFiles = (entryPath) => {
  const absolutePath = path.join(root, entryPath);
  if (!statSafe(absolutePath)) return [];
  const stat = statSync(absolutePath);

  if (stat.isFile()) return [absolutePath];
  if (!stat.isDirectory()) return [];

  const files = [];
  const stack = [absolutePath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const child of readdirSync(current)) {
      const full = path.join(current, child);
      const childStat = statSafe(full);
      if (!childStat) continue;
      if (childStat.isDirectory()) {
        if (!ignoredDirs.has(child)) stack.push(full);
        continue;
      }
      if (ignoredExtensions.has(path.extname(child).toLowerCase())) continue;
      files.push(full);
    }
  }
  return files;
};

const statSafe = (targetPath) => {
  try {
    return statSync(targetPath);
  } catch {
    return null;
  }
};

const files = targetPaths.flatMap(collectFiles);
for (const file of files) {
  const content = readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const pattern of forbiddenPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        errors.push(`${path.relative(root, file)}:${index + 1} contains forbidden service-role reference`);
        break;
      }
    }
  }
}

if (errors.length > 0) {
  process.stderr.write("Frontend secrets check failed:\n");
  for (const error of errors) {
    process.stderr.write(`- ${error}\n`);
  }
  process.exit(1);
}

process.stdout.write("Frontend secrets check passed.\n");
