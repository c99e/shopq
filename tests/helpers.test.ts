import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConfigError, GraphQLError } from "../src/graphql";
import { clampLimit, getClient, handleCommandError } from "../src/helpers";

describe("getClient", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		process.env.SHOPIFY_STORE = "test.myshopify.com";
		process.env.SHOPIFY_CLIENT_ID = "test-client-id";
		process.env.SHOPIFY_CLIENT_SECRET = "test-client-secret";
		delete process.env.SHOPIFY_PROTOCOL;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	test("returns a GraphQL client with https by default", () => {
		const client = getClient({});
		expect(client).toBeDefined();
		expect(typeof client.query).toBe("function");
		expect(typeof client.rawQuery).toBe("function");
	});

	test("uses store flag over env var", () => {
		delete process.env.SHOPIFY_STORE;
		const client = getClient({ store: "flag-store.myshopify.com" });
		expect(client).toBeDefined();
	});

	test("throws ConfigError when store and credentials are missing", () => {
		delete process.env.SHOPIFY_STORE;
		delete process.env.SHOPIFY_CLIENT_ID;
		delete process.env.SHOPIFY_CLIENT_SECRET;
		expect(() => getClient({})).toThrow(ConfigError);
	});

	test("uses http protocol when SHOPIFY_PROTOCOL=http", () => {
		process.env.SHOPIFY_PROTOCOL = "http";
		const client = getClient({});
		expect(client).toBeDefined();
	});

	test("defaults to https when SHOPIFY_PROTOCOL is something else", () => {
		process.env.SHOPIFY_PROTOCOL = "ftp";
		const client = getClient({});
		expect(client).toBeDefined();
	});
});

describe("handleCommandError", () => {
	let stderrOutput: string;
	const originalWrite = process.stderr.write;
	const originalExitCode = process.exitCode ?? 0;

	beforeEach(() => {
		stderrOutput = "";
		process.stderr.write = ((chunk: any) => {
			stderrOutput += String(chunk);
			return true;
		}) as any;
		process.exitCode = undefined;
	});

	afterEach(() => {
		process.stderr.write = originalWrite;
		process.exitCode = originalExitCode;
	});

	test("handles ConfigError with stderr output and exit code 1", () => {
		const err = new ConfigError(["SHOPIFY_STORE", "SHOPIFY_CLIENT_ID"]);
		handleCommandError(err);
		expect(stderrOutput).toContain("Error:");
		expect(stderrOutput).toContain("SHOPIFY_STORE");
		expect(process.exitCode).toBe(1);
	});

	test("handles GraphQLError with stderr output and exit code 1", () => {
		const err = new GraphQLError([{ message: "Something went wrong" }]);
		handleCommandError(err);
		expect(stderrOutput).toContain("Error:");
		expect(stderrOutput).toContain("Something went wrong");
		expect(process.exitCode).toBe(1);
	});

	test("rethrows unknown errors", () => {
		const err = new Error("unexpected");
		expect(() => handleCommandError(err)).toThrow("unexpected");
	});

	test("rethrows non-Error values", () => {
		expect(() => handleCommandError("string error")).toThrow();
	});
});

describe("clampLimit", () => {
	let stderrOutput: string;
	const originalWrite = process.stderr.write;
	const originalExitCode = process.exitCode ?? 0;

	beforeEach(() => {
		stderrOutput = "";
		process.stderr.write = ((chunk: any) => {
			stderrOutput += String(chunk);
			return true;
		}) as any;
		process.exitCode = undefined;
	});

	afterEach(() => {
		process.stderr.write = originalWrite;
		process.exitCode = originalExitCode;
	});

	test("returns default (50) when value is undefined", () => {
		expect(clampLimit(undefined)).toBe(50);
	});

	test("parses and returns valid limit", () => {
		expect(clampLimit("25")).toBe(25);
	});

	test("clamps to 1 when value is 0", () => {
		expect(clampLimit("0")).toBe(1);
		expect(stderrOutput).toContain("--limit");
	});

	test("clamps to 1 when value is negative", () => {
		expect(clampLimit("-1")).toBe(1);
		expect(stderrOutput).toContain("--limit");
	});

	test("clamps to 250 when value exceeds maximum", () => {
		expect(clampLimit("999")).toBe(250);
		expect(stderrOutput).toContain("--limit");
	});

	test("returns 1 for minimum valid value", () => {
		expect(clampLimit("1")).toBe(1);
	});

	test("returns 250 for maximum valid value", () => {
		expect(clampLimit("250")).toBe(250);
	});

	test("clamps NaN input to 1 and warns", () => {
		expect(clampLimit("abc")).toBe(1);
		expect(stderrOutput).toContain("--limit");
	});
});
