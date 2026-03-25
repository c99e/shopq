import { parseArgs } from "./parse";
import { getResource } from "./registry";
import { topLevelHelp, resourceHelp } from "./help";

const pkgPath = new URL("../package.json", import.meta.url).pathname;
const pkg = await Bun.file(pkgPath).json() as { version: string };

export async function run(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);

  if (parsed.flags.version) {
    console.log(pkg.version);
    return;
  }

  if (!parsed.resource || (parsed.flags.help && !parsed.resource)) {
    console.log(topLevelHelp());
    return;
  }

  const resource = getResource(parsed.resource);

  if (parsed.flags.help && parsed.resource) {
    const help = resourceHelp(parsed.resource);
    if (help) {
      console.log(help);
      return;
    }
    // Unknown resource even with --help
    process.stderr.write(`Error: unknown resource "${parsed.resource}"\n`);
    process.exitCode = 2;
    return;
  }

  if (!resource) {
    process.stderr.write(`Error: unknown resource "${parsed.resource}"\n`);
    process.exitCode = 2;
    return;
  }

  if (!parsed.verb) {
    const help = resourceHelp(parsed.resource);
    if (help) console.log(help);
    return;
  }

  const command = resource.verbs.get(parsed.verb);
  if (!command) {
    process.stderr.write(
      `Error: unknown verb "${parsed.verb}" for resource "${parsed.resource}"\n`,
    );
    process.exitCode = 2;
    return;
  }

  await command.handler(parsed);
}
