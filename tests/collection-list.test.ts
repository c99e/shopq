import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolve } from "path";
import type { Server } from "bun";

const BIN = resolve(import.meta.dir, "../bin/misty.ts");

const MOCK_COLLECTIONS = [
  {
    node: {
      id: "gid://shopify/Collection/1",
      title: "Summer Collection",
      handle: "summer-collection",
      descriptionHtml: "<p>Hot summer deals</p>",
      productsCount: { count: 12, precision: "EXACT" },
      image: { url: "https://cdn.shopify.com/summer.jpg", altText: "Summer banner" },
      seo: { title: "Summer Sale", description: "Best summer products" },
    },
  },
  {
    node: {
      id: "gid://shopify/Collection/2",
      title: "Winter Gear",
      handle: "winter-gear",
      descriptionHtml: "<p>Stay warm</p>",
      productsCount: { count: 5, precision: "AT_LEAST" },
      image: null,
      seo: { title: "Winter Gear", description: "Warm clothing" },
    },
  },
];

function makeCollectionsResponse(
  edges = MOCK_COLLECTIONS,
  hasNextPage = false,
  endCursor = "cursor-abc",
) {
  return {
    data: {
      collections: {
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
      lastRequestBody = await req.json();
      const query = lastRequestBody.query as string;

      if (query.includes("collections")) {
        const hasCursor = lastRequestBody.variables?.after === "get-page-2";
        const response = hasCursor
          ? makeCollectionsResponse([MOCK_COLLECTIONS[1]!], false, "cursor-end")
          : makeCollectionsResponse(MOCK_COLLECTIONS, true, "cursor-page2");
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
    MISTY_STORE: `localhost:${mockPort}`,
    MISTY_ACCESS_TOKEN: "shpat_test123",
    MISTY_PROTOCOL: "http",
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

describe("misty collection list", () => {
  test("table output shows collection titles", async () => {
    const { stdout, exitCode } = await run(["collection", "list"]);
    expect(stdout).toContain("Summer Collection");
    expect(stdout).toContain("Winter Gear");
    expect(exitCode).toBe(0);
  });

  test("table output shows all required fields", async () => {
    const { stdout } = await run(["collection", "list"]);
    expect(stdout).toContain("Summer Collection");
    expect(stdout).toContain("summer-collection");
    expect(stdout).toContain("12"); // productsCount
  });

  test("table output shows column headers", async () => {
    const { stdout } = await run(["collection", "list", "--no-color"]);
    expect(stdout).toContain("ID");
    expect(stdout).toContain("Title");
    expect(stdout).toContain("Handle");
    expect(stdout).toContain("Products");
  });

  test("table shows pagination hint when more results", async () => {
    const { stdout } = await run(["collection", "list"]);
    expect(stdout).toContain("More results available");
    expect(stdout).toContain("--cursor");
    expect(stdout).toContain("cursor-page2");
  });

  test("table shows productsCount as count only", async () => {
    const { stdout } = await run(["collection", "list"]);
    expect(stdout).toContain("12");
    expect(stdout).toContain("5");
  });

  test("table shows image presence", async () => {
    const { stdout } = await run(["collection", "list", "--no-color"]);
    expect(stdout).toContain("Image");
  });

  test("--json returns data array with pageInfo", async () => {
    const { stdout, exitCode } = await run(["collection", "list", "--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.data).toBeArray();
    expect(parsed.data.length).toBe(2);
    expect(parsed.data[0].id).toBe("gid://shopify/Collection/1");
    expect(parsed.data[0].title).toBe("Summer Collection");
    expect(parsed.data[0].handle).toBe("summer-collection");
    expect(parsed.data[0].productsCount).toEqual({ count: 12, precision: "EXACT" });
    expect(parsed.data[0].description).toBe("Hot summer deals");
    expect(parsed.data[0].image).toEqual({ url: "https://cdn.shopify.com/summer.jpg", alt: "Summer banner" });
    expect(parsed.data[0].seo).toEqual({ title: "Summer Sale", description: "Best summer products" });
    expect(parsed.data[1].image).toBeNull();
    expect(parsed.pageInfo).toEqual({ hasNextPage: true, endCursor: "cursor-page2" });
    expect(exitCode).toBe(0);
  });

  test("--cursor passes cursor to GraphQL query", async () => {
    const { stdout } = await run(["collection", "list", "--json", "--cursor", "get-page-2"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.data.length).toBe(1);
    expect(parsed.data[0].title).toBe("Winter Gear");
    expect(parsed.pageInfo.hasNextPage).toBe(false);
  });

  test("--limit is passed as variable to GraphQL", async () => {
    await run(["collection", "list", "--limit", "10"]);
    expect(lastRequestBody.variables.first).toBe(10);
  });

  test("default limit is 50", async () => {
    await run(["collection", "list"]);
    expect(lastRequestBody.variables.first).toBe(50);
  });

  test("--limit is clamped to 250", async () => {
    await run(["collection", "list", "--limit", "500"]);
    expect(lastRequestBody.variables.first).toBe(250);
  });

  test("exits with error when credentials missing", async () => {
    const { stderr, exitCode } = await run(["collection", "list"], {
      MISTY_STORE: "",
      MISTY_ACCESS_TOKEN: "",
    });
    expect(stderr).toContain("MISTY_STORE");
    expect(exitCode).toBe(1);
  });

  test("collection --help shows list verb", async () => {
    const { stdout } = await run(["collection", "--help"]);
    expect(stdout).toContain("list");
  });
});
