/**
 * Adds .pi/npm/node_modules/.bin to the bash tool's PATH so that
 * `shopq` (and any other pi-installed CLI) resolves without a global install.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createBashTool } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();

	const bashTool = createBashTool(cwd, {
		spawnHook: ({ command, cwd: spawnCwd, env }) => ({
			command,
			cwd: spawnCwd,
			env: {
				...env,
				PATH: `${cwd}/.pi/npm/node_modules/.bin:${env.PATH ?? ""}`,
			},
		}),
	});

	pi.registerTool({
		...bashTool,
		execute: async (id, params, signal, onUpdate) => {
			return bashTool.execute(id, params, signal, onUpdate);
		},
	});
}
