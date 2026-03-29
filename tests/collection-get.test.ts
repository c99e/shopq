import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { Server } from "bun";

const BIN = resolve(import.meta.dir, "../bin/shopq.ts");

const MOCK_COLLECTION = {
	id: "gid://shopify/Collection/123456",
	title: "Summer Sale",
	handle: "summer-sale",
	descriptionHtml: "<p>Hot deals for summer</p>",
	productsCount: { count: 15, precision: "EXACT" },
	image: {
		url: "https://cdn.shopify.com/summer.jpg",
		altText: "Summer collection",
	},
	seo: {
		title: "Summer Sale | Test Store",
		description: "Shop our summer collection",
	},
};

const _MOCK_COLLECTION_NO_IMAGE = {
	...MOCK_COLLECTION,
	id: "gid://shopify/Collection/789",
	image: null,
};

function makeMockServer(handler: (body: any) => any) {
	return Bun.serve({
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
			const result = handler(body);
			return new Response(JSON.stringify(result), {
				headers: { "Content-Type": "application/json" },
			});
		},
	});
}

let mockServer: Server;
let mockPort: number;

beforeAll(() => {
	mockServer = makeMockServer((body) => {
		const query = body.query as string;
		const variables = body.variables;

		// Handle lookup by ID
		if (query.includes("collection(id:")) {
			if (variables.id === "gid://shopify/Collection/999999") {
				return { data: { collection: null } };
			}
			return { data: { collection: MOCK_COLLECTION } };
		}

		// Handle lookup by handle
		if (query.includes("collectionByHandle")) {
			if (variables.handle === "nonexistent") {
				return { data: { collectionByHandle: null } };
			}
			return { data: { collectionByHandle: MOCK_COLLECTION } };
		}

		return { data: { collection: null } };
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

describe("shopq collection get", () => {
	test("lookup by numeric ID returns collection", async () => {
		const { stdout, exitCode } = await run(["collection", "get", "123456"]);
		expect(stdout).toContain("Summer Sale");
		expect(stdout).toContain("summer-sale");
		expect(exitCode).toBe(0);
	});

	test("lookup by full GID returns collection", async () => {
		const { stdout, exitCode } = await run([
			"collection",
			"get",
			"gid://shopify/Collection/123456",
		]);
		expect(stdout).toContain("Summer Sale");
		expect(exitCode).toBe(0);
	});

	test("lookup by handle returns collection", async () => {
		const { stdout, exitCode } = await run([
			"collection",
			"get",
			"summer-sale",
		]);
		expect(stdout).toContain("Summer Sale");
		expect(exitCode).toBe(0);
	});

	test("table output shows productsCount as number only", async () => {
		const { stdout } = await run(["collection", "get", "123456"]);
		expect(stdout).toContain("15");
		expect(stdout).not.toContain("precision");
	});

	test("table output shows description without HTML", async () => {
		const { stdout } = await run(["collection", "get", "123456"]);
		expect(stdout).toContain("Hot deals for summer");
		expect(stdout).not.toContain("<p>");
	});

	test("table output shows image URL", async () => {
		const { stdout } = await run(["collection", "get", "123456"]);
		expect(stdout).toContain("https://cdn.shopify.com/summer.jpg");
	});

	test("table output shows SEO fields", async () => {
		const { stdout } = await run(["collection", "get", "123456"]);
		expect(stdout).toContain("Summer Sale | Test Store");
		expect(stdout).toContain("Shop our summer collection");
	});

	test("--json returns data envelope with all fields", async () => {
		const { stdout, exitCode } = await run([
			"collection",
			"get",
			"123456",
			"--json",
		]);
		const parsed = JSON.parse(stdout);
		expect(parsed.data).toBeDefined();
		expect(parsed.data.id).toBe("gid://shopify/Collection/123456");
		expect(parsed.data.title).toBe("Summer Sale");
		expect(parsed.data.handle).toBe("summer-sale");
		expect(parsed.data.description).toBe("Hot deals for summer");
		expect(exitCode).toBe(0);
	});

	test("--json returns productsCount as object with count and precision", async () => {
		const { stdout } = await run(["collection", "get", "123456", "--json"]);
		const parsed = JSON.parse(stdout);
		expect(parsed.data.productsCount).toEqual({
			count: 15,
			precision: "EXACT",
		});
	});

	test("--json returns image as object", async () => {
		const { stdout } = await run(["collection", "get", "123456", "--json"]);
		const parsed = JSON.parse(stdout);
		expect(parsed.data.image).toEqual({
			url: "https://cdn.shopify.com/summer.jpg",
			alt: "Summer collection",
		});
	});

	test("--json returns seo as object", async () => {
		const { stdout } = await run(["collection", "get", "123456", "--json"]);
		const parsed = JSON.parse(stdout);
		expect(parsed.data.seo).toEqual({
			title: "Summer Sale | Test Store",
			description: "Shop our summer collection",
		});
	});

	test("not found by ID exits with code 1 and stderr message", async () => {
		const { stderr, exitCode } = await run(["collection", "get", "999999"]);
		expect(stderr).toContain("not found");
		expect(exitCode).toBe(1);
	});

	test("not found by handle exits with code 1 and stderr message", async () => {
		const { stderr, exitCode } = await run([
			"collection",
			"get",
			"nonexistent",
		]);
		expect(stderr).toContain("not found");
		expect(exitCode).toBe(1);
	});

	test("no argument shows usage error", async () => {
		const { stderr, exitCode } = await run(["collection", "get"]);
		expect(stderr).toContain("Usage");
		expect(exitCode).toBe(2);
	});

	test("--handle without positional arg produces helpful error", async () => {
		const { stderr, exitCode } = await run([
			"collection",
			"get",
			"--handle",
			"summer-sale",
		]);
		expect(stderr).toContain("positional");
		expect(exitCode).toBe(2);
	});
});
