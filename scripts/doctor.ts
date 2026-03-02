#!/usr/bin/env bun
/**
 * kuzma doctor — checks that the project is ready to run.
 */

import { existsSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";

let ok = 0;
let warn = 0;
let fail = 0;

function pass(msg: string) { console.log(`  ✓ ${msg}`); ok++; }
function skip(msg: string) { console.log(`  ~ ${msg}`); warn++; }
function err(msg: string) { console.log(`  ✗ ${msg}`); fail++; }

function check(label: string, test: () => boolean | string) {
  try {
    const result = test();
    if (result === true) pass(label);
    else if (result === false) err(label);
    else err(`${label}: ${result}`);
  } catch (e: any) {
    err(`${label}: ${e.message}`);
  }
}

function expandHome(p: string): string {
  return p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : resolve(p);
}

console.log("\n🔍 Kuzma Doctor\n");

// --- Environment ---
console.log("Environment:");

const requiredEnv = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_USER_ID"];
const optionalEnv = ["PARAKEET_URL", "VAULT_PATH", "WORKSPACE_PATH", "DB_PATH", "ASK_USER_BRIDGE_PORT"];

for (const key of requiredEnv) {
  check(key, () => !!process.env[key] || `missing (required)`);
}
for (const key of optionalEnv) {
  if (process.env[key]) pass(`${key} = ${process.env[key]}`);
  else skip(`${key} (using default)`);
}

// --- Paths ---
console.log("\nPaths:");

const vaultPath = expandHome(process.env.VAULT_PATH || "~/vault");
const workspacePath = expandHome(process.env.WORKSPACE_PATH || "~/workspace");
const dbDir = resolve(process.env.DB_PATH || "./data/kuzma.db", "..");

check(`Vault: ${vaultPath}`, () => existsSync(vaultPath) || "directory not found");
check(`Workspace: ${workspacePath}`, () => existsSync(workspacePath) || "directory not found");
check(`DB dir: ${dbDir}`, () => existsSync(dbDir) || "directory not found — run mkdir -p data");

const claudeMd = resolve(workspacePath, "CLAUDE.md");
check(`System prompt: ${claudeMd}`, () => existsSync(claudeMd) || "CLAUDE.md not found — run: bash scripts/setup-vault.sh");

// --- Vault structure ---
console.log("\nVault:");

const vaultFiles = [
  "_system/SOUL.md",
  "_system/MEMORY.md",
  "_system/ACTIVE_CONTEXT.md",
];
const vaultDirs = ["projects", "areas", "daily", "decisions", "inbox"];

for (const f of vaultFiles) {
  check(f, () => existsSync(resolve(vaultPath, f)) || "missing — run: bash scripts/setup-vault.sh");
}
for (const d of vaultDirs) {
  check(`${d}/`, () => existsSync(resolve(vaultPath, d)) || "missing — run: bash scripts/setup-vault.sh");
}

// Check CLAUDE.md is in sync with template
const templatePath = resolve(import.meta.dir, "../templates/CLAUDE.md");
if (existsSync(claudeMd) && existsSync(templatePath)) {
  const deployed = await Bun.file(claudeMd).text();
  const template = await Bun.file(templatePath).text();
  if (deployed.trim() === template.trim()) {
    pass("CLAUDE.md matches template");
  } else {
    skip("CLAUDE.md differs from template — may be intentional, or run: cp templates/CLAUDE.md " + workspacePath);
  }
}

// --- MCP ---
console.log("\nMCP:");

const mcpServerScript = resolve(import.meta.dir, "../src/mcp/ask-user/server.ts");
check("ask_user server script", () => existsSync(mcpServerScript) || "src/mcp/ask-user/server.ts not found");
skip("ask_user registration — verify manually: claude mcp list | grep ask_user");

// --- Dependencies ---
console.log("\nDependencies:");

check("bun", () => {
  const v = Bun.spawnSync({ cmd: ["bun", "--version"] });
  return v.exitCode === 0 || "bun not found";
});

check("claude CLI", () => {
  const v = Bun.spawnSync({ cmd: ["claude", "--version"] });
  return v.exitCode === 0 || "claude not found — install with: npm i -g @anthropic-ai/claude-code";
});

check("ffmpeg", () => {
  const v = Bun.spawnSync({ cmd: ["ffmpeg", "-version"] });
  return v.exitCode === 0 || "ffmpeg not found — needed for voice messages";
});

check("node_modules", () => existsSync("node_modules") || "run: bun install");

// --- Services ---
console.log("\nServices:");

const port = Number(process.env.ASK_USER_BRIDGE_PORT || "3848");
const portCheck = Bun.spawnSync({ cmd: ["lsof", "-ti", `:${port}`] });
if (portCheck.stdout.toString().trim()) {
  skip(`Port ${port} in use (bot may be running)`);
} else {
  pass(`Port ${port} is free`);
}

const parakeetUrl = process.env.PARAKEET_URL || "http://localhost:5092";
try {
  const resp = await fetch(parakeetUrl, { signal: AbortSignal.timeout(2000) });
  pass(`Parakeet STT: ${parakeetUrl} (status ${resp.status})`);
} catch {
  skip(`Parakeet STT: ${parakeetUrl} (not reachable — voice transcription won't work)`);
}

// --- Summary ---
console.log(`\n${ok} passed, ${warn} warnings, ${fail} errors\n`);
if (fail > 0) {
  console.log("Fix the errors above, then run: bun run doctor");
  process.exit(1);
}
if (warn > 0) {
  console.log("Ready to start (with warnings): bun run start");
} else {
  console.log("All good! Start with: bun run start");
}
