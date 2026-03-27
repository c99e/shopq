import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { Server } from "bun";

const BIN = resolve(import.meta.dir, "../bin/shopctl.ts");

const MOCK_PAGES = [
	{
		node: {
			id: "gid://shopify/Page/1",
			title: "About Us",
			handle: "about-us",
			isPublished: true,
			bodySummary: "Learn more about our company",
			createdAt: "2024-01-15T10:00:00Z",
			metafields: {
				edges: [
					{
						node: {
							namespace: "global",
							key: "title_tag",
							value: "About Our Company",
						},
					},
					{
						node: {
							namespace: "global",
							key: "description_tag",
							value: "We are a great company",
						},
					},
				],
			},
		},
	},
	{
		node: {
			id: "gid://shopify/Page/2",
			title: "Contact",
			handle: "contact",
			isPublished: false,
			bodySummary: "Get in touch with us",
			createdAt: "2024-02-20T14:30:00Z",
			metafields: {
				edges: [],
			},
		},
	},
];

function makePagesResponse(
	edges = MOCK_PAGES,
	hasNextPage = false,
	endCursor = "cursor-abc",
) {
	return {
		data: {
			pages: {
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
			const query = lastRequestBody.query as string;

			if (query.includes("pages")) {
				const hasNext = lastRequestBody.variables?.after === "get-page-2";
				const response = hasNext
					? makePagesResponse([MOCK_PAGES[1]!], false, "cursor-end")
					: makePagesResponse(MOCK_PAGES, true, "cursor-page2");
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

describe("shopctl page list", () => {
	test("table output shows page titles", async () => {
		const { stdout, exitCode } = await run(["page", "list"]);
		expect(stdout).toContain("About Us");
		expect(stdout).toContain("Contact");
		expect(exitCode).toBe(0);
	});

	test("table output shows all required fields", async () => {
		const { stdout } = await run(["page", "list"]);
		expect(stdout).toContain("About Us");
		expect(stdout).toContain("about-us");
		expect(stdout).toContain("About Our Company"); // SEO title
	});

	test("table output shows column headers", async () => {
		const { stdout } = await run(["page", "list", "--no-color"]);
		expect(stdout).toContain("ID");
		expect(stdout).toContain("Title");
		expect(stdout).toContain("Handle");
		expect(stdout).toContain("Published");
	});

	test("table shows pagination hint when more results", async () => {
		const { stdout } = await run(["page", "list"]);
		expect(stdout).toContain("More results available");
		expect(stdout).toContain("--cursor");
		expect(stdout).toContain("cursor-page2");
	});

	test("--json returns data array with pageInfo", async () => {
		const { stdout, exitCode } = await run(["page", "list", "--json"]);
		const parsed = JSON.parse(stdout);
		expect(parsed.data).toBeArray();
		expect(parsed.data.length).toBe(2);
		expect(parsed.data[0].id).toBe("gid://shopify/Page/1");
		expect(parsed.data[0].title).toBe("About Us");
		expect(parsed.data[0].handle).toBe("about-us");
		expect(parsed.data[0].published).toBe(true);
		expect(parsed.data[0].bodySummary).toBe("Learn more about our company");
		expect(parsed.data[0].createdAt).toBe("2024-01-15T10:00:00Z");
		expect(parsed.data[0].seo).toEqual({
			title: "About Our Company",
			description: "We are a great company",
		});
		expect(parsed.pageInfo).toEqual({
			hasNextPage: true,
			endCursor: "cursor-page2",
		});
		expect(exitCode).toBe(0);
	});

	test("--json handles pages without SEO metafields", async () => {
		const { stdout } = await run(["page", "list", "--json"]);
		const parsed = JSON.parse(stdout);
		const contactPage = parsed.data[1];
		expect(contactPage.seo).toEqual({ title: null, description: null });
		expect(contactPage.published).toBe(false);
	});

	test("--cursor passes cursor to GraphQL query", async () => {
		const { stdout } = await run([
			"page",
			"list",
			"--json",
			"--cursor",
			"get-page-2",
		]);
		const parsed = JSON.parse(stdout);
		expect(parsed.data.length).toBe(1);
		expect(parsed.data[0].title).toBe("Contact");
		expect(parsed.pageInfo.hasNextPage).toBe(false);
	});

	test("--limit is passed as variable to GraphQL", async () => {
		await run(["page", "list", "--limit", "10"]);
		expect(lastRequestBody.variables.first).toBe(10);
	});

	test("default limit is 50", async () => {
		await run(["page", "list"]);
		expect(lastRequestBody.variables.first).toBe(50);
	});

	test("exits with error when credentials missing", async () => {
		const { stderr, exitCode } = await run(["page", "list"], {
			SHOPIFY_STORE: "",
			SHOPIFY_CLIENT_ID: "",
			SHOPIFY_CLIENT_SECRET: "",
		});
		expect(stderr).toContain("SHOPIFY_STORE");
		expect(exitCode).toBe(1);
	});

	test("page --help shows list verb", async () => {
		const { stdout } = await run(["page", "--help"]);
		expect(stdout).toContain("list");
	});
});
