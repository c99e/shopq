import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { resolve } from "path";
import type { Server } from "bun";

const BIN = resolve(import.meta.dir, "../bin/shopctl.ts");

const FULL_PAGE = {
  id: "gid://shopify/Page/101",
  title: "About Us",
  handle: "about-us",
  isPublished: true,
  body: "<h1>About Us</h1><p>We are a company that does great things. This is the full HTML body content.</p>",
  createdAt: "2024-01-15T10:00:00Z",
  updatedAt: "2024-02-20T14:30:00Z",
  metafields: {
    edges: [
      { node: { namespace: "global", key: "title_tag", value: "About Our Company" } },
      { node: { namespace: "global", key: "description_tag", value: "Learn more about our company" } },
    ],
  },
};

const PAGE_NO_SEO = {
  ...FULL_PAGE,
  id: "gid://shopify/Page/102",
  handle: "no-seo",
  metafields: { edges: [] },
};

let mockServer: Server;
let mockPort: number;
let lastRequestBody: any;
let mockBehavior: "found" | "not-found" | "no-seo" = "found";

beforeAll(() => {
  mockServer = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/admin/oauth/access_token") {
        return new Response(JSON.stringify({
          access_token: "mock-token",
          scope: "read_products,write_products",
          expires_in: 86399,
        }), { headers: { "Content-Type": "application/json" } });
      }
      lastRequestBody = await req.json();
      const query = lastRequestBody.query as string;

      if (query.includes("PageGetByHandle") || query.includes("pageByHandle")) {
        if (mockBehavior === "not-found") {
          return Response.json({ data: { pageByHandle: null } });
        }
        if (mockBehavior === "no-seo") {
          return Response.json({ data: { pageByHandle: PAGE_NO_SEO } });
        }
        return Response.json({ data: { pageByHandle: FULL_PAGE } });
      }

      return Response.json({ data: {} });
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

describe("shopctl page get — found", () => {
  beforeEach(() => { mockBehavior = "found"; });

  test("table output shows page details", async () => {
    const { stdout, exitCode } = await run(["page", "get", "about-us", "--no-color"]);
    expect(stdout).toContain("About Us");
    expect(stdout).toContain("about-us");
    expect(stdout).toContain("gid://shopify/Page/101");
    expect(exitCode).toBe(0);
  });

  test("table output shows full HTML body", async () => {
    const { stdout } = await run(["page", "get", "about-us", "--no-color"]);
    expect(stdout).toContain("<h1>About Us</h1>");
    expect(stdout).toContain("full HTML body content");
  });

  test("table output shows SEO fields", async () => {
    const { stdout } = await run(["page", "get", "about-us", "--no-color"]);
    expect(stdout).toContain("About Our Company");
    expect(stdout).toContain("Learn more about our company");
  });

  test("--json returns data in { data } envelope", async () => {
    const { stdout, exitCode } = await run(["page", "get", "about-us", "--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.data).toBeDefined();
    expect(parsed.data.id).toBe("gid://shopify/Page/101");
    expect(parsed.data.title).toBe("About Us");
    expect(parsed.data.handle).toBe("about-us");
    expect(parsed.data.published).toBe(true);
    expect(parsed.data.createdAt).toBe("2024-01-15T10:00:00Z");
    expect(parsed.data.updatedAt).toBe("2024-02-20T14:30:00Z");
    expect(exitCode).toBe(0);
  });

  test("--json includes full HTML body not truncated", async () => {
    const { stdout } = await run(["page", "get", "about-us", "--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.data.body).toContain("<h1>About Us</h1>");
    expect(parsed.data.body).toContain("full HTML body content");
  });

  test("--json includes SEO fields", async () => {
    const { stdout } = await run(["page", "get", "about-us", "--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.data.seo.title).toBe("About Our Company");
    expect(parsed.data.seo.description).toBe("Learn more about our company");
  });

  test("sends handle variable in GraphQL query", async () => {
    await run(["page", "get", "about-us"]);
    expect(lastRequestBody.variables.handle).toBe("about-us");
  });
});

describe("shopctl page get — not found", () => {
  beforeEach(() => { mockBehavior = "not-found"; });

  test("exits with error when page not found", async () => {
    const { stderr, exitCode } = await run(["page", "get", "nonexistent"]);
    expect(stderr).toContain("not found");
    expect(exitCode).toBe(1);
  });
});

describe("shopctl page get — no SEO", () => {
  beforeEach(() => { mockBehavior = "no-seo"; });

  test("--json returns null SEO fields when no metafields", async () => {
    const { stdout } = await run(["page", "get", "no-seo", "--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.data.seo.title).toBeNull();
    expect(parsed.data.seo.description).toBeNull();
  });
});

describe("shopctl page get — missing args", () => {
  test("exits with error when no handle provided", async () => {
    const { stderr, exitCode } = await run(["page", "get"]);
    expect(stderr).toContain("Usage");
    expect(exitCode).toBe(2);
  });
});
