import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { resolve } from "node:path";
import type { Server } from "bun";

const BIN = resolve(import.meta.dir, "../bin/shopq.ts");

let mockServer: Server;
let mockPort: number;
let deleteCalled: boolean;
let allRequests: any[] = [];
let searchBehavior: "single" | "multiple" | "none" = "single";
let deleteBehavior: "success" | "error" = "success";

const PRODUCT = {
	id: "gid://shopify/Product/5001",
	title: "Doomed Widget",
	status: "ACTIVE",
};

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
			const body = await req.json();
			allRequests.push(body);
			const query = body.query as string;

			// Product get (for resolving product details before delete)
			if (query.includes("product(id:") || query.includes("ProductGet")) {
				return new Response(
					JSON.stringify({
						data: {
							product: {
								id: PRODUCT.id,
								title: PRODUCT.title,
								status: PRODUCT.status,
							},
						},
					}),
					{ headers: { "Content-Type": "application/json" } },
				);
			}

			// Product delete mutation
			if (query.includes("productDelete")) {
				deleteCalled = true;
				if (deleteBehavior === "error") {
					return new Response(
						JSON.stringify({
							data: {
								productDelete: {
									deletedProductId: null,
									userErrors: [{ field: ["id"], message: "Product not found" }],
								},
							},
						}),
						{ headers: { "Content-Type": "application/json" } },
					);
				}
				return new Response(
					JSON.stringify({
						data: {
							productDelete: {
								deletedProductId: PRODUCT.id,
								userErrors: [],
							},
						},
					}),
					{ headers: { "Content-Type": "application/json" } },
				);
			}

			// Title search
			if (query.includes("products") || query.includes("ProductSearch")) {
				if (searchBehavior === "none") {
					return new Response(
						JSON.stringify({
							data: { products: { edges: [] } },
						}),
						{ headers: { "Content-Type": "application/json" } },
					);
				}
				if (searchBehavior === "multiple") {
					return new Response(
						JSON.stringify({
							data: {
								products: {
									edges: [
										{
											node: {
												id: "gid://shopify/Product/5001",
												title: "Doomed Widget",
												status: "ACTIVE",
											},
										},
										{
											node: {
												id: "gid://shopify/Product/5002",
												title: "Doomed Widget Pro",
												status: "DRAFT",
											},
										},
									],
								},
							},
						}),
						{ headers: { "Content-Type": "application/json" } },
					);
				}
				return new Response(
					JSON.stringify({
						data: {
							products: {
								edges: [{ node: PRODUCT }],
							},
						},
					}),
					{ headers: { "Content-Type": "application/json" } },
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

beforeEach(() => {
	allRequests = [];
	deleteCalled = false;
	searchBehavior = "single";
	deleteBehavior = "success";
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

describe("shopq product delete — dry run (no --yes)", () => {
	test("prints what would be deleted and exits 0", async () => {
		const { stdout, exitCode } = await run(["product", "delete", "5001"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Doomed Widget");
		expect(stdout).toContain("gid://shopify/Product/5001");
		expect(deleteCalled).toBe(false);
	});

	test("dry run with --json outputs { data } envelope", async () => {
		const { stdout, exitCode } = await run([
			"product",
			"delete",
			"5001",
			"--json",
		]);
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.data).toBeDefined();
		expect(parsed.data.id).toBe("gid://shopify/Product/5001");
		expect(parsed.data.title).toBe("Doomed Widget");
		expect(deleteCalled).toBe(false);
	});
});

describe("shopq product delete — with --yes", () => {
	test("deletes product and returns title and ID", async () => {
		const { stdout, exitCode } = await run([
			"product",
			"delete",
			"5001",
			"--yes",
		]);
		expect(exitCode).toBe(0);
		expect(deleteCalled).toBe(true);
		expect(stdout).toContain("Doomed Widget");
		expect(stdout).toContain("gid://shopify/Product/5001");
	});

	test("--yes --json returns { data } envelope with deleted info", async () => {
		const { stdout, exitCode } = await run([
			"product",
			"delete",
			"5001",
			"--yes",
			"--json",
		]);
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.data.id).toBe("gid://shopify/Product/5001");
		expect(parsed.data.title).toBe("Doomed Widget");
		expect(deleteCalled).toBe(true);
	});
});

describe("shopq product delete — ID resolution", () => {
	test("accepts numeric ID", async () => {
		const { exitCode } = await run(["product", "delete", "5001", "--yes"]);
		expect(exitCode).toBe(0);
		expect(deleteCalled).toBe(true);
	});

	test("accepts full GID", async () => {
		const { exitCode } = await run([
			"product",
			"delete",
			"gid://shopify/Product/5001",
			"--yes",
		]);
		expect(exitCode).toBe(0);
		expect(deleteCalled).toBe(true);
	});

	test("accepts title string", async () => {
		searchBehavior = "single";
		const { exitCode } = await run([
			"product",
			"delete",
			"Doomed Widget",
			"--yes",
		]);
		expect(exitCode).toBe(0);
		expect(deleteCalled).toBe(true);
	});
});

describe("shopq product delete — errors", () => {
	test("product not found by title exits 1", async () => {
		searchBehavior = "none";
		const { stderr, exitCode } = await run([
			"product",
			"delete",
			"Nonexistent",
			"--yes",
		]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("not found");
		expect(deleteCalled).toBe(false);
	});

	test("multiple title matches exits 1 with candidates", async () => {
		searchBehavior = "multiple";
		const { exitCode } = await run(["product", "delete", "Doomed Widget"]);
		expect(exitCode).toBe(1);
		expect(deleteCalled).toBe(false);
	});

	test("missing id-or-title exits 1", async () => {
		const { stderr, exitCode } = await run(["product", "delete"]);
		expect(exitCode).toBe(2);
		expect(stderr).toContain("Usage");
	});

	test("API error on delete exits 1", async () => {
		deleteBehavior = "error";
		const { stderr, exitCode } = await run([
			"product",
			"delete",
			"5001",
			"--yes",
		]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Product not found");
		expect(deleteCalled).toBe(true);
	});
});
