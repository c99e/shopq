import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { resolve } from "path";
import type { Server } from "bun";

const BIN = resolve(import.meta.dir, "../bin/misty.ts");

const UPDATED_PRODUCT = {
  id: "gid://shopify/Product/1001",
  title: "Updated Widget",
  status: "ACTIVE",
  productType: "Widget",
  vendor: "Acme",
};

let mockServer: Server;
let mockPort: number;
let lastMutationVariables: any;
let allRequests: any[] = [];
let searchBehavior: "single" | "none" = "single";

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
      const body = await req.json();
      allRequests.push(body);
      const query = body.query as string;

      // Product update mutation
      if (query.includes("productUpdate")) {
        lastMutationVariables = body.variables;
        return new Response(JSON.stringify({
          data: {
            productUpdate: {
              product: UPDATED_PRODUCT,
              userErrors: [],
            },
          },
        }), { headers: { "Content-Type": "application/json" } });
      }

      // Title search
      if (query.includes("products") || query.includes("ProductSearch")) {
        if (searchBehavior === "none") {
          return new Response(JSON.stringify({
            data: { products: { edges: [] } },
          }), { headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
          data: {
            products: {
              edges: [
                { node: { id: "gid://shopify/Product/1001", title: "Alpha Widget", status: "ACTIVE" } },
              ],
            },
          },
        }), { headers: { "Content-Type": "application/json" } });
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
  lastMutationVariables = undefined;
  searchBehavior = "single";
});

function run(args: string[], env?: Record<string, string>) {
  const baseEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    MISTY_STORE: `localhost:${mockPort}`,
    MISTY_CLIENT_ID: "test-client-id",
    MISTY_CLIENT_SECRET: "test-client-secret",
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

describe("misty product update — sends only provided fields", () => {
  test("only --title sends title in mutation", async () => {
    const { exitCode } = await run(["product", "update", "1001", "--title", "New Name"]);
    expect(exitCode).toBe(0);
    expect(lastMutationVariables.input.title).toBe("New Name");
    expect(lastMutationVariables.input.descriptionHtml).toBeUndefined();
    expect(lastMutationVariables.input.vendor).toBeUndefined();
  });

  test("only --vendor sends vendor in mutation", async () => {
    const { exitCode } = await run(["product", "update", "1001", "--vendor", "NewVendor"]);
    expect(exitCode).toBe(0);
    expect(lastMutationVariables.input.vendor).toBe("NewVendor");
    expect(lastMutationVariables.input.title).toBeUndefined();
  });

  test("--tags sends tags array", async () => {
    const { exitCode } = await run(["product", "update", "1001", "--tags", "sale,clearance"]);
    expect(exitCode).toBe(0);
    expect(lastMutationVariables.input.tags).toEqual(["sale", "clearance"]);
  });

  test("--status sends uppercased status", async () => {
    const { exitCode } = await run(["product", "update", "1001", "--status", "draft"]);
    expect(exitCode).toBe(0);
    expect(lastMutationVariables.input.status).toBe("DRAFT");
  });

  test("--description sends descriptionHtml", async () => {
    const { exitCode } = await run(["product", "update", "1001", "--description", "<p>New desc</p>"]);
    expect(exitCode).toBe(0);
    expect(lastMutationVariables.input.descriptionHtml).toBe("<p>New desc</p>");
  });

  test("--type sends productType", async () => {
    const { exitCode } = await run(["product", "update", "1001", "--type", "Gadget"]);
    expect(exitCode).toBe(0);
    expect(lastMutationVariables.input.productType).toBe("Gadget");
  });

  test("multiple flags are all included", async () => {
    const { exitCode } = await run([
      "product", "update", "1001",
      "--title", "New",
      "--vendor", "V",
      "--status", "active",
    ]);
    expect(exitCode).toBe(0);
    expect(lastMutationVariables.input.title).toBe("New");
    expect(lastMutationVariables.input.vendor).toBe("V");
    expect(lastMutationVariables.input.status).toBe("ACTIVE");
  });
});

describe("misty product update — ID resolution", () => {
  test("numeric ID is converted to GID", async () => {
    await run(["product", "update", "1001", "--title", "X"]);
    expect(lastMutationVariables.input.id).toBe("gid://shopify/Product/1001");
  });

  test("full GID is used as-is", async () => {
    await run(["product", "update", "gid://shopify/Product/1001", "--title", "X"]);
    expect(lastMutationVariables.input.id).toBe("gid://shopify/Product/1001");
  });

  test("title string resolves via search then updates by resolved ID", async () => {
    searchBehavior = "single";
    await run(["product", "update", "Alpha Widget", "--vendor", "NewVendor"]);
    // Should have searched first, then mutated with the resolved GID
    const searchReq = allRequests.find((r) => r.query.includes("ProductSearch") || r.query.includes("products"));
    expect(searchReq).toBeDefined();
    expect(lastMutationVariables.input.id).toBe("gid://shopify/Product/1001");
    // Title should NOT be in the mutation (wasn't passed as --title)
    expect(lastMutationVariables.input.title).toBeUndefined();
  });

  test("title lookup + explicit --title sends new title, not lookup title", async () => {
    searchBehavior = "single";
    await run(["product", "update", "Alpha Widget", "--title", "Renamed Widget"]);
    expect(lastMutationVariables.input.id).toBe("gid://shopify/Product/1001");
    expect(lastMutationVariables.input.title).toBe("Renamed Widget");
  });
});

describe("misty product update — no update flags", () => {
  test("exits code 2 when no update flags provided", async () => {
    const { stderr, exitCode } = await run(["product", "update", "1001"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("at least one");
  });
});

describe("misty product update — not found", () => {
  test("exits code 1 when title search finds nothing", async () => {
    searchBehavior = "none";
    const { stderr, exitCode } = await run(["product", "update", "Nonexistent", "--title", "X"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });
});

describe("misty product update — output", () => {
  test("table output shows updated summary", async () => {
    const { stdout, exitCode } = await run(["product", "update", "1001", "--title", "New", "--no-color"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("gid://shopify/Product/1001");
  });

  test("--json returns { data } envelope", async () => {
    const { stdout, exitCode } = await run(["product", "update", "1001", "--title", "New", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.data).toBeDefined();
    expect(parsed.data.id).toBe("gid://shopify/Product/1001");
    expect(parsed.data.title).toBe("Updated Widget");
  });
});

describe("misty product update — missing id-or-title", () => {
  test("exits with error when no id-or-title provided", async () => {
    const { stderr, exitCode } = await run(["product", "update"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Usage");
  });
});
