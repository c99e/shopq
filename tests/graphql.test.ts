import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolveConfig, createClient, exchangeToken, API_VERSION } from "../src/graphql";

// --- Config resolution tests ---

describe("resolveConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SHOPIFY_STORE;
    delete process.env.SHOPIFY_CLIENT_ID;
    delete process.env.SHOPIFY_CLIENT_SECRET;
  });

  afterEach(() => {
    process.env.SHOPIFY_STORE = originalEnv.SHOPIFY_STORE;
    process.env.SHOPIFY_CLIENT_ID = originalEnv.SHOPIFY_CLIENT_ID;
    process.env.SHOPIFY_CLIENT_SECRET = originalEnv.SHOPIFY_CLIENT_SECRET;
    if (originalEnv.SHOPIFY_STORE === undefined) delete process.env.SHOPIFY_STORE;
    if (originalEnv.SHOPIFY_CLIENT_ID === undefined) delete process.env.SHOPIFY_CLIENT_ID;
    if (originalEnv.SHOPIFY_CLIENT_SECRET === undefined) delete process.env.SHOPIFY_CLIENT_SECRET;
  });

  test("reads SHOPIFY_STORE, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET from env", () => {
    process.env.SHOPIFY_STORE = "my-shop.myshopify.com";
    process.env.SHOPIFY_CLIENT_ID = "client-id-123";
    process.env.SHOPIFY_CLIENT_SECRET = "client-secret-456";
    const config = resolveConfig();
    expect(config.store).toBe("my-shop.myshopify.com");
    expect(config.clientId).toBe("client-id-123");
    expect(config.clientSecret).toBe("client-secret-456");
  });

  test("--store flag overrides SHOPIFY_STORE", () => {
    process.env.SHOPIFY_STORE = "original.myshopify.com";
    process.env.SHOPIFY_CLIENT_ID = "id";
    process.env.SHOPIFY_CLIENT_SECRET = "secret";
    const config = resolveConfig("override.myshopify.com");
    expect(config.store).toBe("override.myshopify.com");
  });

  test("throws with missing SHOPIFY_STORE", () => {
    process.env.SHOPIFY_CLIENT_ID = "id";
    process.env.SHOPIFY_CLIENT_SECRET = "secret";
    expect(() => resolveConfig()).toThrow("SHOPIFY_STORE");
  });

  test("throws with missing SHOPIFY_CLIENT_ID", () => {
    process.env.SHOPIFY_STORE = "my-shop.myshopify.com";
    process.env.SHOPIFY_CLIENT_SECRET = "secret";
    expect(() => resolveConfig()).toThrow("SHOPIFY_CLIENT_ID");
  });

  test("throws with missing SHOPIFY_CLIENT_SECRET", () => {
    process.env.SHOPIFY_STORE = "my-shop.myshopify.com";
    process.env.SHOPIFY_CLIENT_ID = "id";
    expect(() => resolveConfig()).toThrow("SHOPIFY_CLIENT_SECRET");
  });

  test("throws listing all missing vars when all are missing", () => {
    expect(() => resolveConfig()).toThrow("SHOPIFY_STORE");
    expect(() => resolveConfig()).toThrow("SHOPIFY_CLIENT_ID");
    expect(() => resolveConfig()).toThrow("SHOPIFY_CLIENT_SECRET");
  });

  test("--store flag satisfies missing SHOPIFY_STORE", () => {
    process.env.SHOPIFY_CLIENT_ID = "id";
    process.env.SHOPIFY_CLIENT_SECRET = "secret";
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

// --- Token exchange ---

describe("exchangeToken", () => {
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

  test("POSTs to /admin/oauth/access_token with form-urlencoded body", async () => {
    let receivedContentType = "";
    let receivedBody = "";
    const srv = startServer(async (req) => {
      receivedContentType = req.headers.get("Content-Type") || "";
      receivedBody = await req.text();
      return new Response(JSON.stringify({
        access_token: "token-abc",
        scope: "read_products",
        expires_in: 86399,
      }), { headers: { "Content-Type": "application/json" } });
    });

    await exchangeToken({
      store: `localhost:${srv.port}`,
      clientId: "my-client-id",
      clientSecret: "my-client-secret",
      protocol: "http",
    });

    expect(receivedContentType).toBe("application/x-www-form-urlencoded");
    const params = new URLSearchParams(receivedBody);
    expect(params.get("grant_type")).toBe("client_credentials");
    expect(params.get("client_id")).toBe("my-client-id");
    expect(params.get("client_secret")).toBe("my-client-secret");
  });

  test("returns access token, scope, and expires_in", async () => {
    const srv = startServer(() => {
      return new Response(JSON.stringify({
        access_token: "token-xyz",
        scope: "read_products,write_products",
        expires_in: 86399,
      }), { headers: { "Content-Type": "application/json" } });
    });

    const result = await exchangeToken({
      store: `localhost:${srv.port}`,
      clientId: "id",
      clientSecret: "secret",
      protocol: "http",
    });

    expect(result.accessToken).toBe("token-xyz");
    expect(result.scope).toBe("read_products,write_products");
    expect(result.expiresIn).toBe(86399);
  });

  test("throws on non-2xx response", async () => {
    const srv = startServer(() => {
      return new Response(JSON.stringify({
        error: "invalid_client",
        error_description: "Client authentication failed",
      }), { status: 401 });
    });

    await expect(exchangeToken({
      store: `localhost:${srv.port}`,
      clientId: "bad-id",
      clientSecret: "bad-secret",
      protocol: "http",
    })).rejects.toThrow("401");
  });

  test("throws on shop_not_permitted error", async () => {
    const srv = startServer(() => {
      return new Response(JSON.stringify({
        error: "shop_not_permitted",
        error_description: "Client credentials cannot be performed on this shop.",
      }), { status: 400 });
    });

    await expect(exchangeToken({
      store: `localhost:${srv.port}`,
      clientId: "id",
      clientSecret: "secret",
      protocol: "http",
    })).rejects.toThrow("shop_not_permitted");
  });
});

// --- GraphQL client with auto token exchange ---

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

  test("exchanges credentials and sends access token in header", async () => {
    let graphqlHeaders: Headers | null = null;
    const srv = startServer(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/admin/oauth/access_token") {
        return new Response(JSON.stringify({
          access_token: "exchanged-token-123",
          scope: "read_products",
          expires_in: 86399,
        }), { headers: { "Content-Type": "application/json" } });
      }
      // GraphQL endpoint
      graphqlHeaders = req.headers;
      return new Response(JSON.stringify({ data: { shop: { name: "Test" } } }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = createClient({
      store: `localhost:${srv.port}`,
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      protocol: "http",
    });

    await client.query("{ shop { name } }");
    expect(graphqlHeaders!.get("X-Shopify-Access-Token")).toBe("exchanged-token-123");
  });

  test("caches token across multiple queries", async () => {
    let tokenExchangeCount = 0;
    const srv = startServer(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/admin/oauth/access_token") {
        tokenExchangeCount++;
        return new Response(JSON.stringify({
          access_token: "cached-token",
          scope: "read_products",
          expires_in: 86399,
        }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ data: { ok: true } }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = createClient({
      store: `localhost:${srv.port}`,
      clientId: "id",
      clientSecret: "secret",
      protocol: "http",
    });

    await client.query("{ a }");
    await client.query("{ b }");
    await client.query("{ c }");
    expect(tokenExchangeCount).toBe(1);
  });

  test("refreshes token when expired", async () => {
    let tokenExchangeCount = 0;
    const srv = startServer(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/admin/oauth/access_token") {
        tokenExchangeCount++;
        return new Response(JSON.stringify({
          access_token: `token-${tokenExchangeCount}`,
          scope: "read_products",
          expires_in: 0, // expires immediately
        }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ data: { ok: true } }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = createClient({
      store: `localhost:${srv.port}`,
      clientId: "id",
      clientSecret: "secret",
      protocol: "http",
    });

    await client.query("{ a }");
    // Wait a tick so the 0-second token is expired
    await new Promise((r) => setTimeout(r, 10));
    await client.query("{ b }");
    expect(tokenExchangeCount).toBe(2);
  });

  test("sends correct GraphQL endpoint", async () => {
    let receivedUrl = "";
    const srv = startServer(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/admin/oauth/access_token") {
        return new Response(JSON.stringify({
          access_token: "tok",
          scope: "read_products",
          expires_in: 86399,
        }), { headers: { "Content-Type": "application/json" } });
      }
      receivedUrl = req.url;
      return new Response(JSON.stringify({ data: { shop: { name: "Test" } } }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = createClient({
      store: `localhost:${srv.port}`,
      clientId: "id",
      clientSecret: "secret",
      protocol: "http",
    });

    await client.query("{ shop { name } }");
    expect(receivedUrl).toContain(`/admin/api/${API_VERSION}/graphql.json`);
  });

  test("sends parameterized variables in request body", async () => {
    let receivedBody: any = null;
    const srv = startServer(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/admin/oauth/access_token") {
        return new Response(JSON.stringify({
          access_token: "tok",
          scope: "read_products",
          expires_in: 86399,
        }), { headers: { "Content-Type": "application/json" } });
      }
      receivedBody = await req.json();
      return new Response(JSON.stringify({ data: {} }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = createClient({
      store: `localhost:${srv.port}`,
      clientId: "id",
      clientSecret: "secret",
      protocol: "http",
    });

    await client.query("query($id: ID!) { product(id: $id) { title } }", { id: "gid://shopify/Product/1" });
    expect(receivedBody.query).toBe("query($id: ID!) { product(id: $id) { title } }");
    expect(receivedBody.variables).toEqual({ id: "gid://shopify/Product/1" });
  });

  test("returns data on success", async () => {
    const srv = startServer(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/admin/oauth/access_token") {
        return new Response(JSON.stringify({
          access_token: "tok",
          scope: "read_products",
          expires_in: 86399,
        }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ data: { shop: { name: "TestShop" } } }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = createClient({
      store: `localhost:${srv.port}`,
      clientId: "id",
      clientSecret: "secret",
      protocol: "http",
    });

    const result = await client.query("{ shop { name } }");
    expect(result).toEqual({ shop: { name: "TestShop" } });
  });

  test("throws on GraphQL-level errors", async () => {
    const srv = startServer(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/admin/oauth/access_token") {
        return new Response(JSON.stringify({
          access_token: "tok",
          scope: "read_products",
          expires_in: 86399,
        }), { headers: { "Content-Type": "application/json" } });
      }
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
      clientId: "id",
      clientSecret: "secret",
      protocol: "http",
    });

    expect(client.query("{ product(id: \"1\") { title } }")).rejects.toThrow("Product not found");
  });

  test("throws on HTTP errors with status code and body", async () => {
    const srv = startServer(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/admin/oauth/access_token") {
        return new Response(JSON.stringify({
          access_token: "tok",
          scope: "read_products",
          expires_in: 86399,
        }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response("Internal Server Error", { status: 500 });
    });

    const client = createClient({
      store: `localhost:${srv.port}`,
      clientId: "id",
      clientSecret: "secret",
      protocol: "http",
    });

    expect(client.query("{ shop { name } }")).rejects.toThrow("500");
  });

  test("retries on 429 with backoff", async () => {
    let attempts = 0;
    const srv = startServer(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/admin/oauth/access_token") {
        return new Response(JSON.stringify({
          access_token: "tok",
          scope: "read_products",
          expires_in: 86399,
        }), { headers: { "Content-Type": "application/json" } });
      }
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
      clientId: "id",
      clientSecret: "secret",
      protocol: "http",
    });

    const result = await client.query("{ ok }");
    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(3);
  });

  test("times out when server never responds", async () => {
    const srv = startServer(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/admin/oauth/access_token") {
        return new Response(JSON.stringify({
          access_token: "tok",
          scope: "read_products",
          expires_in: 86399,
        }), { headers: { "Content-Type": "application/json" } });
      }
      await new Promise(() => {});
      return new Response("never");
    });

    const client = createClient({
      store: `localhost:${srv.port}`,
      clientId: "id",
      clientSecret: "secret",
      protocol: "http",
      timeoutMs: 100,
    });

    await expect(client.query("{ shop { name } }")).rejects.toThrow("Request timed out after 100ms");
  });

  test("gives up after max retries on 429", async () => {
    const srv = startServer(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/admin/oauth/access_token") {
        return new Response(JSON.stringify({
          access_token: "tok",
          scope: "read_products",
          expires_in: 86399,
        }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response("Too Many Requests", {
        status: 429,
        headers: { "Retry-After": "0" },
      });
    });

    const client = createClient({
      store: `localhost:${srv.port}`,
      clientId: "id",
      clientSecret: "secret",
      protocol: "http",
      maxRetries: 2,
    });

    expect(client.query("{ ok }")).rejects.toThrow("429");
  });
});
