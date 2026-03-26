import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { resolve } from "path";
import type { Server } from "bun";

const BIN = resolve(import.meta.dir, "../bin/shopctl.ts");

let mockServer: Server;
let mockPort: number;
let deleteCalled: boolean;
let allRequests: any[] = [];
let lookupBehavior: "found" | "not-found" = "found";
let deleteBehavior: "success" | "error" = "success";

const PAGE = {
  id: "gid://shopify/Page/9001",
  title: "Old Promo",
  handle: "old-promo",
};

beforeAll(() => {
  mockServer = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/admin/oauth/access_token") {
        return Response.json({
          access_token: "mock-token",
          scope: "read_products,write_products",
          expires_in: 86399,
        });
      }
      const body = await req.json();
      allRequests.push(body);
      const query = body.query as string;

      // pageDelete mutation (check before page lookup since both contain $id: ID!)
      if (query.includes("pageDelete")) {
        deleteCalled = true;
        if (deleteBehavior === "error") {
          return Response.json({
            data: {
              pageDelete: {
                deletedPageId: null,
                userErrors: [{ field: ["id"], message: "Page could not be deleted" }],
              },
            },
          });
        }
        return Response.json({
          data: {
            pageDelete: {
              deletedPageId: PAGE.id,
              userErrors: [],
            },
          },
        });
      }

      // page by ID
      if (query.includes("page(id:") && !query.includes("pages(")) {
        if (lookupBehavior === "not-found") {
          return Response.json({ data: { page: null } });
        }
        return Response.json({ data: { page: { id: PAGE.id, title: PAGE.title } } });
      }

      // page by handle via pages connection
      if (query.includes("pages(") && body.variables?.query) {
        if (lookupBehavior === "not-found") {
          return Response.json({ data: { pages: { edges: [] } } });
        }
        return Response.json({ data: { pages: { edges: [{ node: { id: PAGE.id, title: PAGE.title } }] } } });
      }

      return Response.json({ data: {} });
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
  lookupBehavior = "found";
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

describe("shopctl page delete — dry run (no --yes)", () => {
  test("prints what would be deleted and exits 0", async () => {
    const { stdout, exitCode } = await run(["page", "delete", "9001"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Old Promo");
    expect(stdout).toContain("gid://shopify/Page/9001");
    expect(deleteCalled).toBe(false);
  });

  test("dry run with --json outputs { data } envelope", async () => {
    const { stdout, exitCode } = await run(["page", "delete", "9001", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.data).toBeDefined();
    expect(parsed.data.id).toBe("gid://shopify/Page/9001");
    expect(parsed.data.title).toBe("Old Promo");
    expect(deleteCalled).toBe(false);
  });
});

describe("shopctl page delete — with --yes", () => {
  test("deletes page and returns title and ID", async () => {
    const { stdout, exitCode } = await run(["page", "delete", "9001", "--yes"]);
    expect(exitCode).toBe(0);
    expect(deleteCalled).toBe(true);
    expect(stdout).toContain("Old Promo");
    expect(stdout).toContain("gid://shopify/Page/9001");
  });

  test("--yes --json returns { data } envelope with deleted info", async () => {
    const { stdout, exitCode } = await run(["page", "delete", "9001", "--yes", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.data.id).toBe("gid://shopify/Page/9001");
    expect(parsed.data.title).toBe("Old Promo");
    expect(deleteCalled).toBe(true);
  });
});

describe("shopctl page delete — ID resolution", () => {
  test("accepts numeric ID", async () => {
    const { exitCode } = await run(["page", "delete", "9001", "--yes"]);
    expect(exitCode).toBe(0);
    expect(deleteCalled).toBe(true);
  });

  test("accepts full GID", async () => {
    const { exitCode } = await run(["page", "delete", "gid://shopify/Page/9001", "--yes"]);
    expect(exitCode).toBe(0);
    expect(deleteCalled).toBe(true);
  });

  test("accepts handle", async () => {
    const { exitCode } = await run(["page", "delete", "old-promo", "--yes"]);
    expect(exitCode).toBe(0);
    expect(deleteCalled).toBe(true);
  });
});

describe("shopctl page delete — errors", () => {
  test("page not found exits 1", async () => {
    lookupBehavior = "not-found";
    const { stderr, exitCode } = await run(["page", "delete", "nonexistent", "--yes"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
    expect(deleteCalled).toBe(false);
  });

  test("missing argument exits 2 with usage", async () => {
    const { stderr, exitCode } = await run(["page", "delete"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Usage");
  });

  test("API error on delete exits 1", async () => {
    deleteBehavior = "error";
    const { stderr, exitCode } = await run(["page", "delete", "9001", "--yes"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Page could not be deleted");
    expect(deleteCalled).toBe(true);
  });
});
