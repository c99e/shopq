import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolve } from "path";
import type { Server } from "bun";

const BIN = resolve(import.meta.dir, "../bin/misty.ts");

const MOCK_SHOP_DATA = {
  data: {
    shop: {
      name: "Test Store",
      email: "test@example.com",
      myshopifyDomain: "test-store.myshopify.com",
      plan: { displayName: "Basic" },
      currencyCode: "USD",
      taxesIncluded: false,
      billingAddress: {
        address1: "123 Main St",
        city: "Ottawa",
        province: "Ontario",
        country: "Canada",
        zip: "K1A 0B1",
      },
      enabledPresentmentCurrencies: ["USD", "CAD", "EUR"],
    },
    productsCount: { count: 42, precision: "EXACT" },
  },
};

let mockServer: Server;
let mockPort: number;

beforeAll(() => {
  mockServer = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/admin/oauth/access_token") {
        return new Response(JSON.stringify({
          access_token: "mock-token",
          scope: "read_products,write_products",
          expires_in: 86399,
        }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(MOCK_SHOP_DATA), {
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

describe("misty shop get", () => {
  test("table output contains shop name", async () => {
    const { stdout, exitCode } = await run(["shop", "get"]);
    expect(stdout).toContain("Test Store");
    expect(exitCode).toBe(0);
  });

  test("table output contains email", async () => {
    const { stdout } = await run(["shop", "get"]);
    expect(stdout).toContain("test@example.com");
  });

  test("table output contains domain", async () => {
    const { stdout } = await run(["shop", "get"]);
    expect(stdout).toContain("test-store.myshopify.com");
  });

  test("table output contains plan display name", async () => {
    const { stdout } = await run(["shop", "get"]);
    expect(stdout).toContain("Basic");
  });

  test("table output contains currency", async () => {
    const { stdout } = await run(["shop", "get"]);
    expect(stdout).toContain("USD");
  });

  test("table output shows productsCount as count number only", async () => {
    const { stdout } = await run(["shop", "get"]);
    expect(stdout).toContain("42");
    expect(stdout).not.toContain("precision");
  });

  test("table output shows enabledPresentmentCurrencies as comma-separated", async () => {
    const { stdout } = await run(["shop", "get"]);
    expect(stdout).toContain("USD, CAD, EUR");
  });

  test("table output shows taxesIncluded", async () => {
    const { stdout } = await run(["shop", "get"]);
    expect(stdout).toContain("false");
  });

  test("table output shows billing address", async () => {
    const { stdout } = await run(["shop", "get"]);
    expect(stdout).toContain("123 Main St");
  });

  test("--json returns data envelope with all fields", async () => {
    const { stdout, exitCode } = await run(["shop", "get", "--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.data).toBeDefined();
    expect(parsed.data.name).toBe("Test Store");
    expect(parsed.data.email).toBe("test@example.com");
    expect(parsed.data.domain).toBe("test-store.myshopify.com");
    expect(parsed.data.plan).toBe("Basic");
    expect(parsed.data.currency).toBe("USD");
    expect(parsed.data.taxesIncluded).toBe(false);
    expect(parsed.data.enabledPresentmentCurrencies).toEqual(["USD", "CAD", "EUR"]);
    expect(exitCode).toBe(0);
  });

  test("--json returns productsCount as object with count and precision", async () => {
    const { stdout } = await run(["shop", "get", "--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.data.productsCount).toEqual({ count: 42, precision: "EXACT" });
  });

  test("--json returns billingAddress as object", async () => {
    const { stdout } = await run(["shop", "get", "--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.data.billingAddress).toEqual({
      address1: "123 Main St",
      city: "Ottawa",
      province: "Ontario",
      country: "Canada",
      zip: "K1A 0B1",
    });
  });

  test("exits with error when credentials missing", async () => {
    const { stderr, exitCode } = await run(["shop", "get"], {
      MISTY_STORE: "",
      MISTY_CLIENT_ID: "",
      MISTY_CLIENT_SECRET: "",
    });
    expect(stderr).toContain("MISTY_STORE");
    expect(exitCode).toBe(1);
  });

  test("shop appears in top-level help", async () => {
    const { stdout } = await run(["--help"]);
    expect(stdout).toContain("shop");
  });

  test("shop --help shows get verb", async () => {
    const { stdout } = await run(["shop", "--help"]);
    expect(stdout).toContain("get");
  });
});
