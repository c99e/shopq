import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { Server } from "bun";

const BIN = resolve(import.meta.dir, "../bin/shopctl.ts");

const FULL_PRODUCT = {
	id: "gid://shopify/Product/1001",
	title: "Alpha Widget",
	status: "ACTIVE",
	productType: "Widget",
	vendor: "Acme",
	tags: ["sale", "new"],
	descriptionHtml:
		"<p>A wonderful widget that does many things and has a very long description that should be truncated in table mode</p>",
	variants: {
		edges: [
			{
				node: {
					id: "gid://shopify/ProductVariant/2001",
					sku: "AW-001",
					price: "29.99",
					selectedOptions: [{ name: "Size", value: "Large" }],
					inventoryQuantity: 50,
				},
			},
			{
				node: {
					id: "gid://shopify/ProductVariant/2002",
					sku: "AW-002",
					price: "19.99",
					selectedOptions: [{ name: "Size", value: "Small" }],
					inventoryQuantity: 25,
				},
			},
		],
	},
	images: {
		edges: [
			{
				node: {
					url: "https://cdn.shopify.com/image1.jpg",
					altText: "Front view",
				},
			},
		],
	},
};

const PRODUCT_B = {
	...FULL_PRODUCT,
	id: "gid://shopify/Product/1002",
	title: "Alpha Widget Pro",
	status: "DRAFT",
};

let mockServer: Server;
let mockPort: number;
let lastRequestBody: any;
let allRequests: any[] = [];
let mockBehavior: "single" | "multiple" | "none" = "single";

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
			allRequests.push(lastRequestBody);
			const query = lastRequestBody.query as string;

			// Direct ID lookup — uses "product(id:" singular
			if (
				query.includes("ProductGet") ||
				(query.includes("product(id:") && !query.includes("products("))
			) {
				if (mockBehavior === "none") {
					return new Response(JSON.stringify({ data: { product: null } }), {
						headers: { "Content-Type": "application/json" },
					});
				}
				return new Response(
					JSON.stringify({ data: { product: FULL_PRODUCT } }),
					{
						headers: { "Content-Type": "application/json" },
					},
				);
			}

			// Title search (products query with title filter)
			if (query.includes("products") || query.includes("ProductSearch")) {
				if (mockBehavior === "none") {
					return new Response(
						JSON.stringify({
							data: { products: { edges: [] } },
						}),
						{
							headers: { "Content-Type": "application/json" },
						},
					);
				}
				if (mockBehavior === "multiple") {
					return new Response(
						JSON.stringify({
							data: {
								products: {
									edges: [
										{
											node: {
												id: FULL_PRODUCT.id,
												title: FULL_PRODUCT.title,
												status: FULL_PRODUCT.status,
											},
										},
										{
											node: {
												id: PRODUCT_B.id,
												title: PRODUCT_B.title,
												status: PRODUCT_B.status,
											},
										},
									],
								},
							},
						}),
						{
							headers: { "Content-Type": "application/json" },
						},
					);
				}
				// single match — return full product
				return new Response(
					JSON.stringify({
						data: {
							products: {
								edges: [
									{
										node: {
											id: FULL_PRODUCT.id,
											title: FULL_PRODUCT.title,
											status: FULL_PRODUCT.status,
										},
									},
								],
							},
						},
					}),
					{
						headers: { "Content-Type": "application/json" },
					},
				);
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

describe("ID resolution", () => {
	test("numeric ID is converted to GID", async () => {
		mockBehavior = "single";
		await run(["product", "get", "1001"]);
		expect(lastRequestBody.variables.id).toBe("gid://shopify/Product/1001");
	});

	test("full GID is used as-is", async () => {
		mockBehavior = "single";
		await run(["product", "get", "gid://shopify/Product/1001"]);
		expect(lastRequestBody.variables.id).toBe("gid://shopify/Product/1001");
	});

	test("non-numeric string triggers title search", async () => {
		mockBehavior = "single";
		allRequests = [];
		await run(["product", "get", "Alpha Widget"]);
		// First request should be the search query
		const searchReq = allRequests.find((r) =>
			r.query.includes("ProductSearch"),
		);
		expect(searchReq).toBeDefined();
		expect(searchReq.variables.query).toContain("Alpha Widget");
	});
});

describe("shopctl product get — by ID", () => {
	test("table output shows product details", async () => {
		mockBehavior = "single";
		const { stdout, exitCode } = await run([
			"product",
			"get",
			"1001",
			"--no-color",
		]);
		expect(stdout).toContain("Alpha Widget");
		expect(stdout).toContain("ACTIVE");
		expect(stdout).toContain("Widget");
		expect(stdout).toContain("Acme");
		expect(stdout).toContain("sale, new");
		expect(exitCode).toBe(0);
	});

	test("table output shows variants", async () => {
		mockBehavior = "single";
		const { stdout } = await run(["product", "get", "1001", "--no-color"]);
		expect(stdout).toContain("AW-001");
		expect(stdout).toContain("29.99");
		expect(stdout).toContain("Large");
		expect(stdout).toContain("50");
	});

	test("table output shows images", async () => {
		mockBehavior = "single";
		const { stdout } = await run(["product", "get", "1001", "--no-color"]);
		expect(stdout).toContain("https://cdn.shopify.com/image1.jpg");
		expect(stdout).toContain("Front view");
	});

	test("table output truncates long description", async () => {
		mockBehavior = "single";
		const { stdout } = await run(["product", "get", "1001", "--no-color"]);
		// Description should be present but truncated (not full HTML)
		expect(stdout).toContain("A wonderful widget");
		expect(stdout).not.toContain("</p>");
	});

	test("--json returns full product in { data } envelope", async () => {
		mockBehavior = "single";
		const { stdout, exitCode } = await run([
			"product",
			"get",
			"1001",
			"--json",
		]);
		const parsed = JSON.parse(stdout);
		expect(parsed.data).toBeDefined();
		expect(parsed.data.id).toBe("gid://shopify/Product/1001");
		expect(parsed.data.title).toBe("Alpha Widget");
		expect(parsed.data.status).toBe("ACTIVE");
		expect(parsed.data.productType).toBe("Widget");
		expect(parsed.data.vendor).toBe("Acme");
		expect(parsed.data.tags).toEqual(["sale", "new"]);
		expect(parsed.data.description).toContain("wonderful widget");
		expect(parsed.data.variants).toBeArray();
		expect(parsed.data.variants.length).toBe(2);
		expect(parsed.data.variants[0].sku).toBe("AW-001");
		expect(parsed.data.images).toBeArray();
		expect(parsed.data.images[0].url).toContain("image1.jpg");
		expect(exitCode).toBe(0);
	});

	test("--json includes full description", async () => {
		mockBehavior = "single";
		const { stdout } = await run(["product", "get", "1001", "--json"]);
		const parsed = JSON.parse(stdout);
		expect(parsed.data.description).toContain("very long description");
	});
});

describe("shopctl product get — not found", () => {
	test("exits with error when product not found by ID", async () => {
		mockBehavior = "none";
		const { stderr, exitCode } = await run(["product", "get", "9999"]);
		expect(stderr).toContain("not found");
		expect(exitCode).toBe(1);
	});

	test("exits with error when no title match", async () => {
		mockBehavior = "none";
		const { stderr, exitCode } = await run(["product", "get", "Nonexistent"]);
		expect(stderr).toContain("not found");
		expect(exitCode).toBe(1);
	});
});

describe("shopctl product get — disambiguation", () => {
	test("multiple title matches prints candidate list and exits 1", async () => {
		mockBehavior = "multiple";
		const { stdout, exitCode } = await run(["product", "get", "Alpha"]);
		expect(stdout).toContain("gid://shopify/Product/1001");
		expect(stdout).toContain("Alpha Widget");
		expect(stdout).toContain("gid://shopify/Product/1002");
		expect(stdout).toContain("Alpha Widget Pro");
		expect(exitCode).toBe(1);
	});
});

describe("shopctl product get — missing args", () => {
	test("exits with error when no id-or-title provided", async () => {
		const { stderr, exitCode } = await run(["product", "get"]);
		expect(stderr).toContain("Usage");
		expect(exitCode).toBe(2);
	});
});
