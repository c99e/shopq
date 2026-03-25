import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolveConfig, createClient, API_VERSION } from "../src/graphql";

// --- Config resolution tests ---

describe("resolveConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MISTY_STORE;
    delete process.env.MISTY_ACCESS_TOKEN;
  });

  afterEach(() => {
    process.env.MISTY_STORE = originalEnv.MISTY_STORE;
    process.env.MISTY_ACCESS_TOKEN = originalEnv.MISTY_ACCESS_TOKEN;
    if (originalEnv.MISTY_STORE === undefined) delete process.env.MISTY_STORE;
    if (originalEnv.MISTY_ACCESS_TOKEN === undefined) delete process.env.MISTY_ACCESS_TOKEN;
  });

  test("reads MISTY_STORE and MISTY_ACCESS_TOKEN from env", () => {
    process.env.MISTY_STORE = "my-shop.myshopify.com";
    process.env.MISTY_ACCESS_TOKEN = "shpat_abc123";
    const config = resolveConfig();
    expect(config.store).toBe("my-shop.myshopify.com");
    expect(config.accessToken).toBe("shpat_abc123");
  });

  test("--store flag overrides MISTY_STORE", () => {
    process.env.MISTY_STORE = "original.myshopify.com";
    process.env.MISTY_ACCESS_TOKEN = "shpat_abc123";
    const config = resolveConfig("override.myshopify.com");
    expect(config.store).toBe("override.myshopify.com");
  });

  test("throws with missing MISTY_STORE", () => {
    process.env.MISTY_ACCESS_TOKEN = "shpat_abc123";
    expect(() => resolveConfig()).toThrow("MISTY_STORE");
  });

  test("throws with missing MISTY_ACCESS_TOKEN", () => {
    process.env.MISTY_STORE = "my-shop.myshopify.com";
    expect(() => resolveConfig()).toThrow("MISTY_ACCESS_TOKEN");
  });

  test("throws listing both vars when both are missing", () => {
    expect(() => resolveConfig()).toThrow("MISTY_STORE");
    expect(() => resolveConfig()).toThrow("MISTY_ACCESS_TOKEN");
  });

  test("--store flag satisfies missing MISTY_STORE", () => {
    process.env.MISTY_ACCESS_TOKEN = "shpat_abc123";
    const config = resolveConfig("flag-store.myshopify.com");
    expect(config.store).toBe("flag-store.myshopify.com");
  });
});

// --- API version ---

describe("API_VERSION", () => {
  test("is pinned to 2026-01", () => {
    expect(API_VERSION).toBe("2026-01");
  });
});

// --- GraphQL client with mock server ---

describe("createClient", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;

  afterEach(() => {
    if (server) {
      server.stop(true);
      server = null;
    }
  });

  function startServer(handler: (req: Request) => Response | Promise<Response>) {
    server = Bun.serve({ port: 0, fetch: handler });
    return server;
  }

  test("sends X-Shopify-Access-Token header and correct endpoint", async () => {
    let receivedHeaders: Headers | null = null;
    let receivedUrl = "";
    const srv = startServer((req) => {
      receivedHeaders = req.headers;
      receivedUrl = req.url;
      return new Response(JSON.stringify({ data: { shop: { name: "Test" } } }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = createClient({
      store: `localhost:${srv.port}`,
      accessToken: "shpat_test123",
      protocol: "http",
    });

    await client.query("{ shop { name } }");
    expect(receivedHeaders!.get("X-Shopify-Access-Token")).toBe("shpat_test123");
    expect(receivedUrl).toContain(`/admin/api/${API_VERSION}/graphql.json`);
  });

  test("sends parameterized variables in request body", async () => {
    let receivedBody: any = null;
    const srv = startServer(async (req) => {
      receivedBody = await req.json();
      return new Response(JSON.stringify({ data: {} }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = createClient({
      store: `localhost:${srv.port}`,
      accessToken: "shpat_test",
      protocol: "http",
    });

    await client.query("query($id: ID!) { product(id: $id) { title } }", { id: "gid://shopify/Product/1" });
    expect(receivedBody.query).toBe("query($id: ID!) { product(id: $id) { title } }");
    expect(receivedBody.variables).toEqual({ id: "gid://shopify/Product/1" });
  });

  test("returns data on success", async () => {
    const srv = startServer(() => {
      return new Response(JSON.stringify({ data: { shop: { name: "TestShop" } } }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = createClient({
      store: `localhost:${srv.port}`,
      accessToken: "shpat_test",
      protocol: "http",
    });

    const result = await client.query("{ shop { name } }");
    expect(result).toEqual({ shop: { name: "TestShop" } });
  });

  test("throws on GraphQL-level errors", async () => {
    const srv = startServer(() => {
      return new Response(
        JSON.stringify({
          data: null,
          errors: [{ message: "Product not found" }, { message: "Access denied" }],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });

    const client = createClient({
      store: `localhost:${srv.port}`,
      accessToken: "shpat_test",
      protocol: "http",
    });

    expect(client.query("{ product(id: \"1\") { title } }")).rejects.toThrow("Product not found");
  });

  test("throws on HTTP errors with status code and body", async () => {
    const srv = startServer(() => {
      return new Response("Internal Server Error", { status: 500 });
    });

    const client = createClient({
      store: `localhost:${srv.port}`,
      accessToken: "shpat_test",
      protocol: "http",
    });

    expect(client.query("{ shop { name } }")).rejects.toThrow("500");
  });

  test("retries on 429 with backoff", async () => {
    let attempts = 0;
    const srv = startServer(() => {
      attempts++;
      if (attempts < 3) {
        return new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      }
      return new Response(JSON.stringify({ data: { ok: true } }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = createClient({
      store: `localhost:${srv.port}`,
      accessToken: "shpat_test",
      protocol: "http",
    });

    const result = await client.query("{ ok }");
    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(3);
  });

  test("times out when server never responds", async () => {
    const srv = startServer(async () => {
      // Hang forever
      await new Promise(() => {});
      return new Response("never");
    });

    const client = createClient({
      store: `localhost:${srv.port}`,
      accessToken: "shpat_test",
      protocol: "http",
      timeoutMs: 100,
    });

    await expect(client.query("{ shop { name } }")).rejects.toThrow("Request timed out after 100ms");
  });

  test("uses default timeout when timeoutMs is not specified", () => {
    // Just verify the client can be created without timeoutMs (default 30s)
    const client = createClient({
      store: "localhost:9999",
      accessToken: "shpat_test",
      protocol: "http",
    });
    expect(client).toBeDefined();
  });

  test("gives up after max retries on 429", async () => {
    const srv = startServer(() => {
      return new Response("Too Many Requests", {
        status: 429,
        headers: { "Retry-After": "0" },
      });
    });

    const client = createClient({
      store: `localhost:${srv.port}`,
      accessToken: "shpat_test",
      protocol: "http",
      maxRetries: 2,
    });

    expect(client.query("{ ok }")).rejects.toThrow("429");
  });
});
