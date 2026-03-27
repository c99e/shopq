import type { CommandDef, Resource } from "./types";

const resources = new Map<string, Resource>();

export function register(
	resourceName: string,
	resourceDescription: string,
	verbName: string,
	command: CommandDef,
): void {
	let resource = resources.get(resourceName);
	if (!resource) {
		resource = {
			name: resourceName,
			description: resourceDescription,
			verbs: new Map(),
		};
		resources.set(resourceName, resource);
	}
	resource.verbs.set(verbName, command);
}

export function getResource(name: string): Resource | undefined {
	return resources.get(name);
}

export function getAllResources(): Map<string, Resource> {
	return resources;
}
