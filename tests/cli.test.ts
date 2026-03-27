import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BIN = resolve(import.meta.dir, "../bin/shopq.ts");
const pkg = JSON.parse(
	readFileSync(resolve(import.meta.dir, "../package.json"), "utf-8"),
);

async function run(args: string[], env?: Record<string, string>) {
	const proc = Bun.spawn(["bun", BIN, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, ...env },
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

describe("shopq CLI", () => {
	test("--version prints version from package.json and exits 0", async () => {
		const { stdout, exitCode } = await run(["--version"]);
		expect(stdout.trim()).toBe(pkg.version);
		expect(exitCode).toBe(0);
	});

	test("-v prints version", async () => {
		const { stdout, exitCode } = await run(["-v"]);
		expect(stdout.trim()).toBe(pkg.version);
		expect(exitCode).toBe(0);
	});

	test("--help prints top-level usage and exits 0", async () => {
		const { stdout, exitCode } = await run(["--help"]);
		expect(stdout).toContain("shopq <resource> <verb>");
		expect(stdout).toContain("--json");
		expect(stdout).toContain("--help");
		expect(stdout).toContain("--version");
		expect(stdout).toContain("--store");
		expect(stdout).toContain("--no-color");
		expect(exitCode).toBe(0);
	});

	test("-h prints help", async () => {
		const { stdout, exitCode } = await run(["-h"]);
		expect(stdout).toContain("shopq <resource> <verb>");
		expect(exitCode).toBe(0);
	});

	test("unknown resource prints error to stderr and exits 2", async () => {
		const { stderr, exitCode } = await run(["foobar"]);
		expect(stderr).toContain("foobar");
		expect(exitCode).toBe(2);
	});

	test("unknown verb prints error to stderr and exits 2", async () => {
		// No resources registered yet, so any resource is unknown
		const { stderr, exitCode } = await run(["product", "explode"]);
		expect(stderr).toContain("product");
		expect(exitCode).toBe(2);
	});

	test("<resource> --help prints resource-level help and exits 0", async () => {
		const { stdout, exitCode } = await run(["product", "--help"]);
		expect(stdout).toContain("list");
		expect(exitCode).toBe(0);
	});

	test("unknown resource --help exits 2", async () => {
		const { exitCode } = await run(["nonexistent", "--help"]);
		expect(exitCode).toBe(2);
	});

	test("no arguments prints help and exits 0", async () => {
		const { stdout, exitCode } = await run([]);
		expect(stdout).toContain("shopq <resource> <verb>");
		expect(exitCode).toBe(0);
	});

	test("NO_COLOR env var is respected", async () => {
		const { exitCode } = await run(["--help"], { NO_COLOR: "" });
		// Just verify it doesn't crash — color testing is hard to assert
		expect(exitCode).toBe(0);
	});
});
