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
	tmpDir = await mkdtemp(join(tmpdir(), "shopctl-page-test-"));

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

describe("shopctl page create — flag validation", () => {
	test("exits with code 2 when --title is missing", async () => {
		const { stderr, exitCode } = await run(["page", "create"]);
		expect(stderr).toContain("--title");
		expect(exitCode).toBe(2);
	});

	test("exits with code 2 when both --body and --body-file are provided", async () => {
		const { stderr, exitCode } = await run([
			"page",
			"create",
			"--title",
			"Test",
			"--body",
			"<p>hi</p>",
			"--body-file",
			"some.html",
		]);
		expect(stderr).toContain("--body");
		expect(stderr).toContain("--body-file");
		expect(exitCode).toBe(2);
	});
});

describe("shopctl page create — inline body", () => {
	test("creates page with inline body and returns handle and ID", async () => {
		mockResponses.push((body) => {
			if (body.query.includes("pageCreate")) {
				return jsonRes({
					pageCreate: {
						page: { id: "gid://shopify/Page/1001", handle: "about-us" },
						userErrors: [],
					},
				});
			}
			return null;
		});

		const { stdout, exitCode } = await run([
			"page",
			"create",
			"--title",
			"About Us",
			"--body",
			"<p>Hello</p>",
			"--json",
		]);
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.data.id).toBe("gid://shopify/Page/1001");
		expect(parsed.data.handle).toBe("about-us");

		// Check mutation input
		const input = allRequests[0].variables.page;
		expect(input.title).toBe("About Us");
		expect(input.body).toBe("<p>Hello</p>");
		expect(input.isPublished).toBe(false);
	});
});

describe("shopctl page create — body from file", () => {
	test("reads body from file path", async () => {
		const bodyFile = join(tmpDir, "page-body.html");
		await writeFile(bodyFile, "<h1>From File</h1>");

		mockResponses.push((body) => {
			if (body.query.includes("pageCreate")) {
				return jsonRes({
					pageCreate: {
						page: { id: "gid://shopify/Page/1002", handle: "from-file" },
						userErrors: [],
					},
				});
			}
			return null;
		});

		const { exitCode } = await run([
			"page",
			"create",
			"--title",
			"From File",
			"--body-file",
			bodyFile,
			"--json",
		]);
		expect(exitCode).toBe(0);

		const input = allRequests[0].variables.page;
		expect(input.body).toBe("<h1>From File</h1>");
	});
});

describe("shopctl page create — published flag", () => {
	test("defaults to unpublished", async () => {
		mockResponses.push((body) => {
			if (body.query.includes("pageCreate")) {
				return jsonRes({
					pageCreate: {
						page: { id: "gid://shopify/Page/1003", handle: "unpub" },
						userErrors: [],
					},
				});
			}
			return null;
		});

		await run(["page", "create", "--title", "Unpub Page"]);

		const input = allRequests[0].variables.page;
		expect(input.isPublished).toBe(false);
	});

	test("publishes when --published true is passed", async () => {
		mockResponses.push((body) => {
			if (body.query.includes("pageCreate")) {
				return jsonRes({
					pageCreate: {
						page: { id: "gid://shopify/Page/1004", handle: "pub" },
						userErrors: [],
					},
				});
			}
			return null;
		});

		await run(["page", "create", "--title", "Pub Page", "--published", "true"]);

		const input = allRequests[0].variables.page;
		expect(input.isPublished).toBe(true);
	});
});

describe("shopctl page create — SEO metafields", () => {
	test("sends metafield mutations for SEO fields", async () => {
		mockResponses.push((body) => {
			if (body.query.includes("pageCreate")) {
				return jsonRes({
					pageCreate: {
						page: { id: "gid://shopify/Page/1005", handle: "seo-page" },
						userErrors: [],
					},
				});
			}
			return null;
		});

		const { exitCode } = await run([
			"page",
			"create",
			"--title",
			"SEO Page",
			"--seo-title",
			"My SEO Title",
			"--seo-desc",
			"My SEO Description",
			"--json",
		]);
		expect(exitCode).toBe(0);

		// SEO fields should be sent as metafields in the page create input
		const input = allRequests[0].variables.page;
		expect(input.metafields).toBeDefined();
		expect(input.metafields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					namespace: "global",
					key: "title_tag",
					type: "single_line_text_field",
					value: "My SEO Title",
				}),
				expect.objectContaining({
					namespace: "global",
					key: "description_tag",
					type: "single_line_text_field",
					value: "My SEO Description",
				}),
			]),
		);
	});
});

describe("shopctl page create — handle flag", () => {
	test("passes handle to mutation input", async () => {
		mockResponses.push((body) => {
			if (body.query.includes("pageCreate")) {
				return jsonRes({
					pageCreate: {
						page: { id: "gid://shopify/Page/1006", handle: "custom-handle" },
						userErrors: [],
					},
				});
			}
			return null;
		});

		await run([
			"page",
			"create",
			"--title",
			"Custom Handle",
			"--handle",
			"custom-handle",
		]);

		const input = allRequests[0].variables.page;
		expect(input.handle).toBe("custom-handle");
	});
});

describe("shopctl page create — GraphQL errors", () => {
	test("reports userErrors from the mutation", async () => {
		mockResponses.push((body) => {
			if (body.query.includes("pageCreate")) {
				return jsonRes({
					pageCreate: {
						page: null,
						userErrors: [{ field: ["title"], message: "Title is too long" }],
					},
				});
			}
			return null;
		});

		const { stderr, exitCode } = await run([
			"page",
			"create",
			"--title",
			"Bad Page",
		]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Title is too long");
	});
});

describe("shopctl page create — file-read error handling", () => {
	test("exits with error when --body-file does not exist", async () => {
		const { stderr, exitCode } = await run([
			"page",
			"create",
			"--title",
			"Test",
			"--body-file",
			"/tmp/nonexistent-body-file-12345.html",
		]);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("nonexistent-body-file-12345.html");
		// Should be a formatted error, not a raw ENOENT dump
		expect(stderr).toMatch(/^Error:/m);
		expect(stderr).not.toContain("ENOENT");
		expect(stderr).not.toContain("syscall");
	});
});
