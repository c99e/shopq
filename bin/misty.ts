#!/usr/bin/env bun

import "../src/commands/config";
import { run } from "../src/cli";

await run(process.argv.slice(2));
