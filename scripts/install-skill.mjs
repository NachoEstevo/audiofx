#!/usr/bin/env node
// Copies every skill in skills/ to the Claude Code and Codex skill folders.
// Only replaces targets this script installed itself (marked with .audiofx-skill).
// The skills say {{AUDIOFX_DIR}} wherever they need this checkout's path; the copy gets the real one.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skills = readdirSync(path.join(root, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const MARKER = ".audiofx-skill";
const ROOT_POSIX = root.split(path.sep).join("/");

/** Fills in {{AUDIOFX_DIR}} in every Markdown file of an installed skill. */
function fillPaths(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) fillPaths(full);
    else if (entry.name.endsWith(".md")) writeFileSync(full, readFileSync(full, "utf8").replaceAll("{{AUDIOFX_DIR}}", ROOT_POSIX));
  }
}
const targets = [path.join(homedir(), ".claude", "skills"), path.join(homedir(), ".codex", "skills")];

for (const base of targets) {
  if (!existsSync(base)) {
    console.log(`– ${base} does not exist, skipping.`);
    continue;
  }
  for (const name of skills) {
    const source = path.join(root, "skills", name);
    const target = path.join(base, name);
    if (existsSync(target)) {
      if (lstatSync(target).isSymbolicLink() || !existsSync(path.join(target, MARKER))) {
        console.error(`✘ ${target} already exists and was not installed by AudioFX. Leaving it alone.`);
        process.exitCode = 1;
        continue;
      }
      rmSync(target, { recursive: true });
    }
    mkdirSync(target, { recursive: true });
    cpSync(source, target, { recursive: true });
    fillPaths(target);
    writeFileSync(path.join(target, MARKER), `Installed from ${source}. Replaced by pnpm skill:install.\n`);
    console.log(`✔ ${target}`);
  }
}
