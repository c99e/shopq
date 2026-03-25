#!/usr/bin/env bun

import "../src/commands/config";
import "../src/commands/gql";
import { run } from "../src/cli";

await run(process.argv.slice(2));
