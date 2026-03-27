import { API_VERSION, resolveConfig } from "../graphql";
import { handleCommandError } from "../helpers";
import { formatOutput } from "../output";
import { register } from "../registry";
import type { ParsedArgs } from "../types";

function maskToken(token: string): string {
	if (token.length <= 4) return "****";
	return `****${token.slice(-4)}`;
}

async function handleConfigShow(parsed: ParsedArgs): Promise<void> {
	try {
		const config = resolveConfig(parsed.flags.store);

		const data = {
			store: config.store,
			apiVersion: API_VERSION,
			clientId: maskToken(config.clientId),
			clientSecret: maskToken(config.clientSecret),
		};

		const columns = [
			{ key: "store", header: "Store" },
			{ key: "apiVersion", header: "API Version" },
			{ key: "clientId", header: "Client ID" },
			{ key: "clientSecret", header: "Client Secret" },
		];

		formatOutput(data, columns, {
			json: parsed.flags.json,
			noColor: parsed.flags.noColor,
		});
	} catch (err) {
		handleCommandError(err);
	}
}

register("config", "Configuration management", "show", {
	description: "Show current configuration",
	handler: handleConfigShow,
});
