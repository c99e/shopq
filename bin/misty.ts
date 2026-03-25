#!/usr/bin/env bun

import "../src/commands/config";
import "../src/commands/gql";
import "../src/commands/shop";
import "../src/commands/product";
import "../src/commands/menu";
import { run } from "../src/cli";

await run(process.argv.slice(2));
