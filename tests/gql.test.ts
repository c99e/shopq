import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "path";

const BIN = resolve(import.meta.dir, "../bin/shopctl.ts");

// Helper to run CLI as a subprocess
async function run(
  args: string[],
  opts?: { env?: Record<string, string>; stdin?: string },
) {
  const proc = Bun.spawn(["bun", BIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: opts?.stdin !== undefined ? "pipe" : undefined,
    env: { ...process.env, ...opts?.env },
  });
  if (opts?.stdin !== undefined && proc.stdin) {
    proc.stdin.write(opts.stdin);
    proc.stdin.end();
  }
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

// Helper to start a mock GraphQL server
function startMockServer(handler: (req: Request) => Response | Promise<Response>) {
  return Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/admin/oauth/access_token") {
        return new Response(JSON.stringify({
          access_token: "mock-token",
          scope: "read_products,write_products",
          expires_in: 86399,
        }), { headers: { "Content-Type": "application/json" } });
      }
      return handler(req);
    },
  });
}

describe("shopctl gql", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;

  function envForServer() {
    return {
      SHOPIFY_STORE: `localhost:${server!.port}`,
      SHOPIFY_CLIENT_ID: "test-client-id",
      SHOPIFY_CLIENT_SECRET: "test-client-secret",
      SHOPIFY_PROTOCOL: "http",
    };
  }

  afterEach(() => {
    if (server) {
      server.stop(true);
      server = null;
    }
  });

  // --- Usage errors (exit code 2) ---

  test("exits 2 with error when no query is provided", async () => {
    const { stderr, exitCode } = await run(["gql"], {
      env: { SHOPIFY_STORE: "test.myshopify.com", SHOPIFY_CLIENT_ID: "test-client-id", SHOPIFY_CLIENT_SECRET: "test-client-secret" },
    });
    expect(exitCode).toBe(2);
    expect(stderr).toContain("No query provided");
  });

  test("exits 2 when --vars is invalid JSON", async () => {
    server = startMockServer(() => new Response(JSON.stringify({ data: {} })));
    const { stderr, exitCode } = await run(
      ["gql", "{ shop { name } }", "--vars", "not-json"],
      { env: envForServer() },
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("--vars");
  });

  test("exits 2 when --file points to nonexistent file", async () => {
    const { stderr, exitCode } = await run(
      ["gql", "--file", "/tmp/nonexistent_query_abc123.graphql"],
      { env: { SHOPIFY_STORE: "test.myshopify.com", SHOPIFY_CLIENT_ID: "test-client-id", SHOPIFY_CLIENT_SECRET: "test-client-secret" } },
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("nonexistent");
  });

  // --- Inline query ---

  test("sends inline query and outputs raw JSON response", async () => {
    const responsePayload = { data: { shop: { name: "TestShop" } } };
    let receivedBody: any = null;
    server = startMockServer(async (req) => {
      receivedBody = await req.json();
      return new Response(JSON.stringify(responsePayload), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const { stdout, exitCode } = await run(["gql", "{ shop { name } }"], {
      env: envForServer(),
    });

    expect(exitCode).toBe(0);
    expect(receivedBody.query).toBe("{ shop { name } }");
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual(responsePayload);
  });

  test("passes --vars as variables in request body", async () => {
    let receivedBody: any = null;
    server = startMockServer(async (req) => {
      receivedBody = await req.json();
      return new Response(JSON.stringify({ data: { product: { title: "Widget" } } }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const vars = JSON.stringify({ id: "gid://shopify/Product/1" });
    const { exitCode } = await run(
      ["gql", "query($id: ID!) { product(id: $id) { title } }", "--vars", vars],
      { env: envForServer() },
    );

    expect(exitCode).toBe(0);
    expect(receivedBody.variables).toEqual({ id: "gid://shopify/Product/1" });
  });

  // --- Stdin mode ---

  test("reads query from stdin when - is passed", async () => {
    let receivedBody: any = null;
    server = startMockServer(async (req) => {
      receivedBody = await req.json();
      return new Response(JSON.stringify({ data: { shop: { name: "StdinShop" } } }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const { stdout, exitCode } = await run(["gql", "-"], {
      env: envForServer(),
      stdin: "{ shop { name } }",
    });

    expect(exitCode).toBe(0);
    expect(receivedBody.query).toBe("{ shop { name } }");
    const parsed = JSON.parse(stdout);
    expect(parsed.data.shop.name).toBe("StdinShop");
  });

  // --- File mode ---

  test("reads query from file with --file flag", async () => {
    const tmpFile = "/tmp/shopctl_test_query.graphql";
    await Bun.write(tmpFile, "{ shop { name } }");

    let receivedBody: any = null;
    server = startMockServer(async (req) => {
      receivedBody = await req.json();
      return new Response(JSON.stringify({ data: { shop: { name: "FileShop" } } }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const { stdout, exitCode } = await run(["gql", "--file", tmpFile], {
      env: envForServer(),
    });

    expect(exitCode).toBe(0);
    expect(receivedBody.query).toBe("{ shop { name } }");
    const parsed = JSON.parse(stdout);
    expect(parsed.data.shop.name).toBe("FileShop");
  });

  // --- GraphQL errors ---

  test("prints errors to stderr and exits 1 on GraphQL errors", async () => {
    server = startMockServer(() => {
      return new Response(
        JSON.stringify({
          data: null,
          errors: [{ message: "Field 'foo' not found" }, { message: "Access denied" }],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });

    const { stdout, stderr, exitCode } = await run(["gql", "{ foo }"], {
      env: envForServer(),
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Field 'foo' not found");
    expect(stderr).toContain("Access denied");
    // stdout should NOT have the response
    expect(stdout.trim()).toBe("");
  });

  // --- Extensions passthrough ---

  test("includes extensions in raw output when present", async () => {
    const responsePayload = {
      data: { shop: { name: "Test" } },
      extensions: { cost: { requestedQueryCost: 10 } },
    };
    server = startMockServer(() => {
      return new Response(JSON.stringify(responsePayload), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const { stdout, exitCode } = await run(["gql", "{ shop { name } }"], {
      env: envForServer(),
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.extensions).toEqual({ cost: { requestedQueryCost: 10 } });
  });

  // --- Auth ---

  test("exits 1 when credentials are missing", async () => {
    const { stderr, exitCode } = await run(["gql", "{ shop { name } }"], {
      env: { SHOPIFY_STORE: "", SHOPIFY_CLIENT_ID: "", SHOPIFY_CLIENT_SECRET: "" },
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("SHOPIFY_STORE");
  });
});
