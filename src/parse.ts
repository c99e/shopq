import type { ParsedArgs, GlobalFlags } from "./types";

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: GlobalFlags = {
    json: false,
    help: false,
    version: false,
    noColor: "NO_COLOR" in process.env,
  };

  const positional: string[] = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--version" || arg === "-v") {
      flags.version = true;
    } else if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--json" || arg === "-j") {
      flags.json = true;
    } else if (arg === "--no-color") {
      flags.noColor = true;
    } else if (arg === "--store") {
      i++;
      flags.store = argv[i]!;
    } else if (arg?.startsWith("--store=")) {
      flags.store = arg.slice("--store=".length);
    } else if (arg) {
      positional.push(arg);
    }
    i++;
  }

  return {
    resource: positional[0],
    verb: positional[1],
    args: positional.slice(2),
    flags,
  };
}
