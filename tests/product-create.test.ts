import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Server } from "bun";

const BIN = resolve(import.meta.dir, "../bin/shopctl.ts");

let mockServer: Server;
let mockPort: number;
let allRequests: any[] = [];
let mockResponses: Array<(body: any) => Response | null> = [];
let tmpDir: string;

beforeAll(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "shopctl-test-"));

	mockServer = Bun.serve({
		port: 0,
		fetch: async (req) => {
			const url = new URL(req.url);
			if (url.pathname === "/admin/oauth/access_token") {
				return new Response(
					JSON.stringify({
						access_token: "mock-token",
						scope: "read_products,write_products",
						expires_in: 86399,
					}),
					{ headers: { "Content-Type": "application/json" } },
				);
			}
			const body = await req.json();
			allRequests.push(body);

			for (const handler of mockResponses) {
				const res = handler(body);
				if (res) return res;
			}

			return new Response(JSON.stringify({ data: {} }), {
				headers: { "Content-Type": "application/json" },
			});
		},
	});
	mockPort = mockServer.port;
});

afterAll(async () => {
	mockServer.stop();
	await rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
	allRequests = [];
	mockResponses = [];
});

function jsonRes(data: any) {
	return new Response(JSON.stringify({ data }), {
		headers: { "Content-Type": "application/json" },
	});
}

function _errorRes(errors: Array<{ message: string }>) {
	return new Response(JSON.stringify({ data: null, errors }), {
		headers: { "Content-Type": "application/json" },
	});
}

function run(args: string[], env?: Record<string, string>) {
	const baseEnv = {
		PATH: process.env.PATH,
		HOME: process.env.HOME,
		SHOPIFY_STORE: `localhost:${mockPort}`,
		SHOPIFY_CLIENT_ID: "test-client-id",
		SHOPIFY_CLIENT_SECRET: "test-client-secret",
		SHOPIFY_PROTOCOL: "http",
		...env,
	};
	const proc = Bun.spawn(["bun", BIN, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: baseEnv,
	});
	return Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]).then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
}

describe("shopctl product create — flag validation", () => {
	test("exits with code 2 when --title is missing", async () => {
		const { stderr, exitCode } = await run(["product", "create"]);
		expect(stderr).toContain("--title");
		expect(exitCode).toBe(2);
	});

	test("exits with code 2 when --variants is provided without --options", async () => {
		const variantsFile = join(tmpDir, "variants-no-opts.json");
		await writeFile(
			variantsFile,
			JSON.stringify([
				{
					optionValues: [{ name: "Large", optionName: "Size" }],
					price: "10.00",
				},
			]),
		);

		const { stderr, exitCode } = await run([
			"product",
			"create",
			"--title",
			"Test",
			"--variants",
			variantsFile,
		]);
		expect(stderr).toContain("--options");
		expect(exitCode).toBe(2);
	});
});

describe("shopctl product create — single-variant (no --variants)", () => {
	test("creates product with one mutation and returns product ID", async () => {
		mockResponses.push((body) => {
			if (body.query.includes("productCreate")) {
				return jsonRes({
					productCreate: {
						product: { id: "gid://shopify/Product/5001" },
						userErrors: [],
					},
				});
			}
			return null;
		});

		const { stdout, exitCode } = await run([
			"product",
			"create",
			"--title",
			"Simple Product",
			"--json",
		]);
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.data.productId).toBe("gid://shopify/Product/5001");

		// Should only have one request (productCreate)
		expect(allRequests.length).toBe(1);
		expect(allRequests[0].query).toContain("productCreate");
		// Check status defaults to DRAFT
		expect(allRequests[0].variables.input.status).toBe("DRAFT");
	});

	test("passes all flags to the mutation", async () => {
		mockResponses.push((body) => {
			if (body.query.includes("productCreate")) {
				return jsonRes({
					productCreate: {
						product: { id: "gid://shopify/Product/5002" },
						userErrors: [],
					},
				});
			}
			return null;
		});

		await run([
			"product",
			"create",
			"--title",
			"Full Product",
			"--handle",
			"full-product",
			"--type",
			"Widget",
			"--vendor",
			"Acme",
			"--tags",
			"sale,new",
			"--description",
			"<p>A product</p>",
			"--status",
			"active",
		]);

		const input = allRequests[0].variables.input;
		expect(input.title).toBe("Full Product");
		expect(input.handle).toBe("full-product");
		expect(input.productType).toBe("Widget");
		expect(input.vendor).toBe("Acme");
		expect(input.tags).toEqual(["sale", "new"]);
		expect(input.descriptionHtml).toBe("<p>A product</p>");
		expect(input.status).toBe("ACTIVE");
	});
});

describe("shopctl product create — multi-variant", () => {
	test("chains create product → options → bulk variants", async () => {
		const variantsFile = join(tmpDir, "variants.json");
		await writeFile(
			variantsFile,
			JSON.stringify([
				{
					optionValues: [{ name: "Large", optionName: "Size" }],
					price: "29.99",
				},
				{
					optionValues: [{ name: "Small", optionName: "Size" }],
					price: "19.99",
				},
			]),
		);

		const _requestIndex = 0;
		mockResponses.push((body) => {
			if (body.query.includes("productCreate")) {
				return jsonRes({
					productCreate: {
						product: { id: "gid://shopify/Product/6001" },
						userErrors: [],
					},
				});
			}
			if (body.query.includes("productOptionsCreate")) {
				return jsonRes({
					productOptionsCreate: {
						product: { id: "gid://shopify/Product/6001" },
						userErrors: [],
					},
				});
			}
			if (body.query.includes("productVariantsBulkCreate")) {
				return jsonRes({
					productVariantsBulkCreate: {
						productVariants: [
							{ id: "gid://shopify/ProductVariant/7001" },
							{ id: "gid://shopify/ProductVariant/7002" },
						],
						userErrors: [],
					},
				});
			}
			return null;
		});

		const { stdout, exitCode } = await run([
			"product",
			"create",
			"--title",
			"Multi Product",
			"--options",
			"Size",
			"--variants",
			variantsFile,
			"--json",
		]);

		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.data.productId).toBe("gid://shopify/Product/6001");
		expect(parsed.data.variantIds).toEqual([
			"gid://shopify/ProductVariant/7001",
			"gid://shopify/ProductVariant/7002",
		]);

		// Should have 3 requests: create, options, variants
		expect(allRequests.length).toBe(3);
		expect(allRequests[0].query).toContain("productCreate");
		expect(allRequests[1].query).toContain("productOptionsCreate");
		expect(allRequests[2].query).toContain("productVariantsBulkCreate");
	});
});

describe("shopctl product create — partial failure rollback", () => {
	test("deletes product if variant creation fails", async () => {
		const variantsFile = join(tmpDir, "variants-fail.json");
		await writeFile(
			variantsFile,
			JSON.stringify([
				{
					optionValues: [{ name: "Large", optionName: "Size" }],
					price: "29.99",
				},
			]),
		);

		mockResponses.push((body) => {
			if (body.query.includes("productCreate")) {
				return jsonRes({
					productCreate: {
						product: { id: "gid://shopify/Product/8001" },
						userErrors: [],
					},
				});
			}
			if (body.query.includes("productOptionsCreate")) {
				return jsonRes({
					productOptionsCreate: {
						product: { id: "gid://shopify/Product/8001" },
						userErrors: [],
					},
				});
			}
			if (body.query.includes("productVariantsBulkCreate")) {
				return jsonRes({
					productVariantsBulkCreate: {
						productVariants: null,
						userErrors: [
							{ field: ["variants"], message: "Invalid variant data" },
						],
					},
				});
			}
			if (body.query.includes("productDelete")) {
				return jsonRes({
					productDelete: {
						deletedProductId: "gid://shopify/Product/8001",
						userErrors: [],
					},
				});
			}
			return null;
		});

		const { stderr, exitCode } = await run([
			"product",
			"create",
			"--title",
			"Rollback Product",
			"--options",
			"Size",
			"--variants",
			variantsFile,
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain("rollback");

		// Should have 4 requests: create, options, variants (fail), delete (rollback)
		const deleteReq = allRequests.find((r) =>
			r.query.includes("productDelete"),
		);
		expect(deleteReq).toBeDefined();
		expect(deleteReq.variables.input.id).toBe("gid://shopify/Product/8001");
	});

	test("deletes product if option creation fails", async () => {
		const variantsFile = join(tmpDir, "variants-opt-fail.json");
		await writeFile(
			variantsFile,
			JSON.stringify([
				{
					optionValues: [{ name: "Large", optionName: "Size" }],
					price: "29.99",
				},
			]),
		);

		mockResponses.push((body) => {
			if (body.query.includes("productCreate")) {
				return jsonRes({
					productCreate: {
						product: { id: "gid://shopify/Product/8002" },
						userErrors: [],
					},
				});
			}
			if (body.query.includes("productOptionsCreate")) {
				return jsonRes({
					productOptionsCreate: {
						product: null,
						userErrors: [{ field: ["options"], message: "Invalid option" }],
					},
				});
			}
			if (body.query.includes("productDelete")) {
				return jsonRes({
					productDelete: {
						deletedProductId: "gid://shopify/Product/8002",
						userErrors: [],
					},
				});
			}
			return null;
		});

		const { stderr, exitCode } = await run([
			"product",
			"create",
			"--title",
			"Rollback Options",
			"--options",
			"Size",
			"--variants",
			variantsFile,
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain("rollback");

		const deleteReq = allRequests.find((r) =>
			r.query.includes("productDelete"),
		);
		expect(deleteReq).toBeDefined();
	});
});

describe("shopctl product create — file-read error handling", () => {
	test("exits with error when --variants file does not exist", async () => {
		const { stderr, exitCode } = await run([
			"product",
			"create",
			"--title",
			"Test",
			"--options",
			"Size",
			"--variants",
			"/tmp/nonexistent-file-12345.json",
		]);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("nonexistent-file-12345.json");
		expect(stderr).toMatch(/^Error:/m);
		expect(stderr).not.toContain("ENOENT");
		expect(stderr).not.toContain("syscall");
	});

	test("exits with error when --variants file contains invalid JSON", async () => {
		const badJsonFile = join(tmpDir, "bad-variants.json");
		await writeFile(badJsonFile, "{ not valid json }}}");

		const { stderr, exitCode } = await run([
			"product",
			"create",
			"--title",
			"Test",
			"--options",
			"Size",
			"--variants",
			badJsonFile,
		]);
		expect(exitCode).not.toBe(0);
		expect(stderr).toMatch(/parse|json|invalid/i);
		expect(stderr).toMatch(/^Error:/m);
	});
});
