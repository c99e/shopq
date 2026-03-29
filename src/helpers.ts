import { existsSync, readFileSync } from "node:fs";

import type { GraphQLClient } from "./graphql";
import {
	ConfigError,
	createClient,
	GraphQLError,
	resolveConfig,
} from "./graphql";
import { formatError } from "./output";
import type { ParsedArgs } from "./types";

/**
 * Create a GraphQL client from parsed flags.
 * Centralizes resolveConfig + SHOPIFY_PROTOCOL + createClient.
 */
export function getClient(flags: { store?: string }): GraphQLClient {
	const config = resolveConfig(flags.store);
	const protocol = process.env.SHOPIFY_PROTOCOL === "http" ? "http" : "https";
	return createClient({ ...config, protocol });
}

/**
 * Shared error handler for command catch blocks.
 * Handles ConfigError and GraphQLError with stderr + exit code 1.
 * Rethrows anything else.
 */
export function handleCommandError(err: unknown): void {
	if (err instanceof ConfigError) {
		formatError(err.message);
		process.exitCode = 1;
		return;
	}
	if (err instanceof GraphQLError) {
		formatError(err.message);
		process.exitCode = 1;
		return;
	}
	if (err instanceof Error) {
		throw err;
	}
	throw new Error(String(err));
}

/**
 * Check if the user passed --handle as a flag instead of a positional arg.
 * Returns true (and sets error + exit code) if the flag was misused.
 * Callers should return early when this returns true.
 */
export function rejectHandleFlag(parsed: ParsedArgs, usage: string): boolean {
	if (parsed.args.length === 0 && parsed.flags.handle) {
		formatError(
			`--handle is not a flag for this command. Pass the identifier as a positional argument: ${usage}`,
		);
		process.exitCode = 2;
		return true;
	}
	return false;
}

/**
 * Read a file as text, with user-friendly error handling.
 * Returns the file contents or writes an error to stderr and sets exit code 1.
 * Returns null on failure so callers can return early.
 */
export async function readFileText(path: string): Promise<string | null> {
	if (!existsSync(path)) {
		formatError(`File not found: ${path}`);
		process.exitCode = 1;
		return null;
	}
	try {
		return readFileSync(path, "utf-8");
	} catch (_err) {
		formatError(`Failed to read file: ${path}`);
		process.exitCode = 1;
		return null;
	}
}

/**
 * Read a file and parse it as JSON, with user-friendly error handling.
 * Returns the parsed value or null on failure.
 */
/**
 * Parse and clamp a --limit flag value to [1, 250].
 * Returns the default (50) when the value is undefined.
 * Writes a warning to stderr when the value is out of range.
 */
export function clampLimit(
	value: string | undefined,
	defaultLimit = 50,
): number {
	if (value === undefined) return defaultLimit;
	const n = parseInt(value, 10);
	if (Number.isNaN(n) || n < 1) {
		process.stderr.write(
			`Warning: --limit value "${value}" is invalid, using 1\n`,
		);
		return 1;
	}
	if (n > 250) {
		process.stderr.write(
			`Warning: --limit value "${value}" exceeds maximum, using 250\n`,
		);
		return 250;
	}
	return n;
}

export async function readFileJson(path: string): Promise<any | null> {
	const text = await readFileText(path);
	if (text === null) return null;
	try {
		return JSON.parse(text);
	} catch (_err) {
		formatError(`Invalid JSON in file: ${path}`);
		process.exitCode = 1;
		return null;
	}
}
