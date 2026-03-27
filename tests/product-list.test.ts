import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { Server } from "bun";

const BIN = resolve(import.meta.dir, "../bin/shopq.ts");

const MOCK_PRODUCTS = [
	{
		node: {
			id: "gid://shopify/Product/1",
			title: "Alpha Widget",
			status: "ACTIVE",
			productType: "Widget",
			vendor: "Acme",
			variantsCount: { count: 3 },
			totalInventory: 100,
		},
	},
	{
		node: {
			id: "gid://shopify/Product/2",
			title: "Beta Gadget",
			status: "DRAFT",
			productType: "Gadget",
			vendor: "Globex",
			variantsCount: { count: 1 },
			totalInventory: 0,
		},
	},
];

function makeProductsResponse(
	edges = MOCK_PRODUCTS,
	hasNextPage = false,
	endCursor = "cursor-abc",
) {
	return {
		data: {
			products: {
				edges,
				pageInfo: { hasNextPage, endCursor },
			},
		},
	};
}

let mockServer: Server;
let mockPort: number;
let lastRequestBody: any;

beforeAll(() => {
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
			lastRequestBody = await req.json();
			// Default: return products with no next page
			const query = lastRequestBody.query as string;

			if (query.includes("products")) {
				const hasNext = lastRequestBody.variables?.after === "get-page-2";
				const response = hasNext
					? makeProductsResponse([MOCK_PRODUCTS[1]!], false, "cursor-end")
					: makeProductsResponse(MOCK_PRODUCTS, true, "cursor-page2");
				return new Response(JSON.stringify(response), {
					headers: { "Content-Type": "application/json" },
				});
			}

			return new Response(JSON.stringify({ data: {} }), {
				headers: { "Content-Type": "application/json" },
			});
		},
	});
	mockPort = mockServer.port;
});

afterAll(() => {
	mockServer.stop();
});

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

describe("shopq product list", () => {
	test("table output shows product titles", async () => {
		const { stdout, exitCode } = await run(["product", "list"]);
		expect(stdout).toContain("Alpha Widget");
		expect(stdout).toContain("Beta Gadget");
		expect(exitCode).toBe(0);
	});

	test("table output shows all required fields", async () => {
		const { stdout } = await run(["product", "list"]);
		expect(stdout).toContain("Alpha Widget");
		expect(stdout).toContain("ACTIVE");
		expect(stdout).toContain("Widget");
		expect(stdout).toContain("Acme");
		expect(stdout).toContain("3"); // variantsCount
		expect(stdout).toContain("100"); // totalInventory
	});

	test("table output shows column headers", async () => {
		const { stdout } = await run(["product", "list", "--no-color"]);
		expect(stdout).toContain("ID");
		expect(stdout).toContain("Title");
		expect(stdout).toContain("Status");
		expect(stdout).toContain("Type");
		expect(stdout).toContain("Vendor");
		expect(stdout).toContain("Variants");
		expect(stdout).toContain("Inventory");
	});

	test("table shows pagination hint when more results", async () => {
		const { stdout } = await run(["product", "list"]);
		expect(stdout).toContain("More results available");
		expect(stdout).toContain("--cursor");
		expect(stdout).toContain("cursor-page2");
	});

	test("--json returns data array with pageInfo", async () => {
		const { stdout, exitCode } = await run(["product", "list", "--json"]);
		const parsed = JSON.parse(stdout);
		expect(parsed.data).toBeArray();
		expect(parsed.data.length).toBe(2);
		expect(parsed.data[0].id).toBe("gid://shopify/Product/1");
		expect(parsed.data[0].title).toBe("Alpha Widget");
		expect(parsed.data[0].status).toBe("ACTIVE");
		expect(parsed.data[0].productType).toBe("Widget");
		expect(parsed.data[0].vendor).toBe("Acme");
		expect(parsed.data[0].variantsCount).toBe(3);
		expect(parsed.data[0].totalInventory).toBe(100);
		expect(parsed.pageInfo).toEqual({
			hasNextPage: true,
			endCursor: "cursor-page2",
		});
		expect(exitCode).toBe(0);
	});

	test("--cursor passes cursor to GraphQL query", async () => {
		const { stdout } = await run([
			"product",
			"list",
			"--json",
			"--cursor",
			"get-page-2",
		]);
		const parsed = JSON.parse(stdout);
		// When cursor=get-page-2, mock returns page 2 (1 product, no next page)
		expect(parsed.data.length).toBe(1);
		expect(parsed.data[0].title).toBe("Beta Gadget");
		expect(parsed.pageInfo.hasNextPage).toBe(false);
	});

	test("--limit is passed as variable to GraphQL", async () => {
		await run(["product", "list", "--limit", "10"]);
		expect(lastRequestBody.variables.first).toBe(10);
	});

	test("default limit is 50", async () => {
		await run(["product", "list"]);
		expect(lastRequestBody.variables.first).toBe(50);
	});

	test("--limit is clamped to 250", async () => {
		await run(["product", "list", "--limit", "500"]);
		expect(lastRequestBody.variables.first).toBe(250);
	});

	test("--status filter is passed as query parameter", async () => {
		await run(["product", "list", "--status", "active"]);
		expect(lastRequestBody.variables.query).toContain("status:active");
	});

	test("--type filter is passed as query parameter", async () => {
		await run(["product", "list", "--type", "Widget"]);
		expect(lastRequestBody.variables.query).toContain("product_type:Widget");
	});

	test("--vendor filter is passed as query parameter", async () => {
		await run(["product", "list", "--vendor", "Acme"]);
		expect(lastRequestBody.variables.query).toContain("vendor:Acme");
	});

	test("multiple filters are combined", async () => {
		await run(["product", "list", "--status", "active", "--vendor", "Acme"]);
		const query = lastRequestBody.variables.query;
		expect(query).toContain("status:active");
		expect(query).toContain("vendor:Acme");
	});

	test("default sort is by title", async () => {
		await run(["product", "list"]);
		expect(lastRequestBody.variables.sortKey).toBe("TITLE");
	});

	test("exits with error when credentials missing", async () => {
		const { stderr, exitCode } = await run(["product", "list"], {
			SHOPIFY_STORE: "",
			SHOPIFY_CLIENT_ID: "",
			SHOPIFY_CLIENT_SECRET: "",
		});
		expect(stderr).toContain("SHOPIFY_STORE");
		expect(exitCode).toBe(1);
	});

	test("product appears in top-level help", async () => {
		const { stdout } = await run(["--help"]);
		expect(stdout).toContain("product");
	});

	test("product --help shows list verb", async () => {
		const { stdout } = await run(["product", "--help"]);
		expect(stdout).toContain("list");
	});
});
