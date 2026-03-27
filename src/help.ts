import { getAllResources, getResource } from "./registry";

export function topLevelHelp(): string {
	const lines = [
		"Usage: shopctl <resource> <verb> [args] [flags]",
		"",
		"Global Flags:",
		"  --json, -j       Output as JSON",
		"  --help, -h       Show help",
		"  --version, -v    Print version",
		"  --store <url>    Store override",
		"  --no-color       Disable colored output (also respects NO_COLOR env)",
		"",
	];

	const resources = getAllResources();
	if (resources.size > 0) {
		lines.push("Resources:");
		for (const [name, res] of resources) {
			lines.push(`  ${name.padEnd(16)} ${res.description}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

export function resourceHelp(resourceName: string): string | undefined {
	const resource = getResource(resourceName);
	if (!resource) return undefined;

	const lines = [
		`Usage: shopctl ${resourceName} <verb> [args] [flags]`,
		"",
		`${resource.description}`,
		"",
		"Verbs:",
	];

	for (const [verb, cmd] of resource.verbs) {
		lines.push(`  ${verb.padEnd(16)} ${cmd.description}`);
	}
	lines.push("");

	return lines.join("\n");
}
