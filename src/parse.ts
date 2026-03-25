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
    } else if (arg === "--vars") {
      i++;
      flags.vars = argv[i]!;
    } else if (arg?.startsWith("--vars=")) {
      flags.vars = arg.slice("--vars=".length);
    } else if (arg === "--file") {
      i++;
      flags.file = argv[i]!;
    } else if (arg?.startsWith("--file=")) {
      flags.file = arg.slice("--file=".length);
    } else if (arg === "--status") {
      i++;
      flags.status = argv[i]!;
    } else if (arg?.startsWith("--status=")) {
      flags.status = arg.slice("--status=".length);
    } else if (arg === "--type") {
      i++;
      flags.type = argv[i]!;
    } else if (arg?.startsWith("--type=")) {
      flags.type = arg.slice("--type=".length);
    } else if (arg === "--vendor") {
      i++;
      flags.vendor = argv[i]!;
    } else if (arg?.startsWith("--vendor=")) {
      flags.vendor = arg.slice("--vendor=".length);
    } else if (arg === "--limit") {
      i++;
      flags.limit = argv[i]!;
    } else if (arg?.startsWith("--limit=")) {
      flags.limit = arg.slice("--limit=".length);
    } else if (arg === "--cursor") {
      i++;
      flags.cursor = argv[i]!;
    } else if (arg?.startsWith("--cursor=")) {
      flags.cursor = arg.slice("--cursor=".length);
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
