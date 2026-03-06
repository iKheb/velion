import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const host = "127.0.0.1";
const port = 4173;
const baseUrl = `http://${host}:${port}`;
const timeoutMs = 30000;
const pollIntervalMs = 500;
const routes = ["/", "/login", "/messages", "/streaming", "/support"];

function startPreview() {
  const cmd = `npm run preview -- --host ${host} --port ${port}`;
  return spawn(cmd, {
    shell: true,
    stdio: "pipe",
    env: process.env,
    windowsHide: true,
  });
}

async function waitForServer(url, timeout) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout while the preview server starts.
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`Preview server did not start within ${timeout}ms`);
}

async function assertRoute(url) {
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Smoke test failed for ${url}: status ${response.status}`);
  }

  const html = await response.text();
  if (!html.includes('id="root"')) {
    throw new Error(`Smoke test failed for ${url}: missing app root element`);
  }
}

async function run() {
  const preview = startPreview();
  let stderr = "";

  preview.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer(baseUrl, timeoutMs);

    for (const route of routes) {
      await assertRoute(`${baseUrl}${route}`);
    }

    process.stdout.write(
      `Smoke preview passed on ${routes.length} routes at ${baseUrl}\n`,
    );
  } finally {
    preview.kill("SIGTERM");
    await delay(500);
    if (!preview.killed) {
      preview.kill("SIGKILL");
    }
  }

  if (stderr.trim()) {
    process.stdout.write(stderr);
  }
}

run().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
