#!/usr/bin/env node
// CLI launcher with no build step: registers tsx and loads the TypeScript source.
import { register } from "tsx/esm/api";

register();
await import("../src/cli.ts");
