import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { Server } from "bun";

const BIN = resolve(import.meta.dir, "../bin/shopq.ts");

const MOCK_MENU_ITEM = {
	title: "Home",
	url: "https://example.com/",
	type: "HTTP",
	items: [
		{
			title: "About",
			url: "https://example.com/about",
			type: "HTTP",
			items: [
				{
					title: "Team",
					url: "https://example.com/about/team",
					type: "HTTP",
					items: [],
				},
			],
		},
	],
};

const MOCK_MENUS = [
	{
		node: {
			id: "gid://shopify/Menu/1",
			title: "Main Menu",
			handle: "main-menu",
			items: [MOCK_MENU_ITEM],
		},
	},
	{
		node: {
			id: "gid://shopify/Menu/2",
			title: "Footer",
			handle: "footer",
			items: [],
		},
	},
];

let mockServer: Server;
let mockPort: number;

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
			const query = body.query as string;

			if (query.includes("menus")) {
				return new Response(
					JSON.stringify({
						data: {
							menus: {
								edges: MOCK_MENUS,
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

describe("shopq menu list", () => {
	test("table output shows menu titles", async () => {
		const { stdout, exitCode } = await run(["menu", "list"]);
		expect(stdout).toContain("Main Menu");
		expect(stdout).toContain("Footer");
		expect(exitCode).toBe(0);
	});

	test("table output shows all required fields", async () => {
		const { stdout } = await run(["menu", "list"]);
		expect(stdout).toContain("Main Menu");
		expect(stdout).toContain("main-menu");
	});

	test("table output shows indented item hierarchy", async () => {
		const { stdout } = await run(["menu", "list", "--no-color"]);
		expect(stdout).toContain("Home");
		expect(stdout).toContain("About");
		expect(stdout).toContain("Team");
		// Verify indentation increases for nested items
		const lines = stdout.split("\n");
		const homeLine = lines.find(
			(l: string) => l.includes("Home") && l.includes("HTTP"),
		);
		const aboutLine = lines.find(
			(l: string) =>
				l.includes("About") && l.includes("HTTP") && !l.includes("Home"),
		);
		const teamLine = lines.find(
			(l: string) => l.includes("Team") && l.includes("HTTP"),
		);
		expect(homeLine).toBeDefined();
		expect(aboutLine).toBeDefined();
		expect(teamLine).toBeDefined();
		// About should be indented more than Home, Team more than About
		const homeIndent = homeLine!.search(/\S/);
		const aboutIndent = aboutLine!.search(/\S/);
		const teamIndent = teamLine!.search(/\S/);
		expect(aboutIndent).toBeGreaterThan(homeIndent);
		expect(teamIndent).toBeGreaterThan(aboutIndent);
	});

	test("--json returns data array with full nested tree", async () => {
		const { stdout, exitCode } = await run(["menu", "list", "--json"]);
		const parsed = JSON.parse(stdout);
		expect(parsed.data).toBeArray();
		expect(parsed.data.length).toBe(2);
		expect(parsed.data[0].id).toBe("gid://shopify/Menu/1");
		expect(parsed.data[0].title).toBe("Main Menu");
		expect(parsed.data[0].handle).toBe("main-menu");
		expect(parsed.data[0].itemCount).toBe(1);
		expect(parsed.data[0].items).toBeArray();
		expect(parsed.data[0].items[0].title).toBe("Home");
		expect(parsed.data[0].items[0].items[0].title).toBe("About");
		expect(parsed.data[0].items[0].items[0].items[0].title).toBe("Team");
		expect(exitCode).toBe(0);
	});

	test("--json handles menu with no items", async () => {
		const { stdout } = await run(["menu", "list", "--json"]);
		const parsed = JSON.parse(stdout);
		const footer = parsed.data[1];
		expect(footer.title).toBe("Footer");
		expect(footer.itemCount).toBe(0);
		expect(footer.items).toEqual([]);
	});

	test("exits with error when credentials missing", async () => {
		const { stderr, exitCode } = await run(["menu", "list"], {
			SHOPIFY_STORE: "",
			SHOPIFY_CLIENT_ID: "",
			SHOPIFY_CLIENT_SECRET: "",
		});
		expect(stderr).toContain("SHOPIFY_STORE");
		expect(exitCode).toBe(1);
	});

	test("menu --help shows list verb", async () => {
		const { stdout } = await run(["menu", "--help"]);
		expect(stdout).toContain("list");
	});
});
