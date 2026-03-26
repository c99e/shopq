import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolve } from "path";
import type { Server } from "bun";

const BIN = resolve(import.meta.dir, "../bin/misty.ts");

const MOCK_THEMES = [
  {
    node: {
      id: "gid://shopify/OnlineStoreTheme/123456789",
      name: "Dawn",
      role: "MAIN",
      createdAt: "2024-01-15T10:30:00Z",
      updatedAt: "2024-06-20T14:45:00Z",
    },
  },
  {
    node: {
      id: "gid://shopify/OnlineStoreTheme/987654321",
      name: "Debut",
      role: "UNPUBLISHED",
      createdAt: "2023-05-10T08:00:00Z",
      updatedAt: "2024-03-12T09:15:00Z",
    },
  },
  {
    node: {
      id: "gid://shopify/OnlineStoreTheme/555555555",
      name: "Draft Theme",
      role: "DEVELOPMENT",
      createdAt: "2024-06-01T12:00:00Z",
      updatedAt: "2024-06-25T16:30:00Z",
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
        return new Response(JSON.stringify({
          access_token: "mock-token",
          scope: "read_products,write_products",
          expires_in: 86399,
        }), { headers: { "Content-Type": "application/json" } });
      }
      const body = await req.json();
      const query = body.query as string;

      if (query.includes("themes")) {
        return new Response(
          JSON.stringify({
            data: {
              themes: {
                edges: MOCK_THEMES,
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

describe("misty theme list", () => {
  test("table output shows theme names and roles", async () => {
    const { stdout, exitCode } = await run(["theme", "list"]);
    expect(stdout).toContain("Dawn");
    expect(stdout).toContain("MAIN");
    expect(stdout).toContain("Debut");
    expect(stdout).toContain("UNPUBLISHED");
    expect(stdout).toContain("Draft Theme");
    expect(stdout).toContain("DEVELOPMENT");
    expect(exitCode).toBe(0);
  });

  test("table output is human-readable with all required fields", async () => {
    const { stdout } = await run(["theme", "list", "--no-color"]);
    expect(stdout).toContain("Dawn");
    expect(stdout).toContain("123456789");
    expect(stdout).toContain("MAIN");
  });

  test("--json returns data array with all required fields", async () => {
    const { stdout, exitCode } = await run(["theme", "list", "--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.data).toBeArray();
    expect(parsed.data.length).toBe(3);

    const dawn = parsed.data[0];
    expect(dawn.id).toBe("gid://shopify/OnlineStoreTheme/123456789");
    expect(dawn.numericId).toBe("123456789");
    expect(dawn.name).toBe("Dawn");
    expect(dawn.role).toBe("MAIN");
    expect(dawn.createdAt).toBe("2024-01-15T10:30:00Z");
    expect(dawn.updatedAt).toBe("2024-06-20T14:45:00Z");
    expect(exitCode).toBe(0);
  });

  test("--json MAIN role is clearly indicated", async () => {
    const { stdout } = await run(["theme", "list", "--json"]);
    const parsed = JSON.parse(stdout);
    const mainTheme = parsed.data.find((t: any) => t.role === "MAIN");
    expect(mainTheme).toBeDefined();
    expect(mainTheme.name).toBe("Dawn");
  });

  test("exits with error when credentials missing", async () => {
    const { stderr, exitCode } = await run(["theme", "list"], {
      MISTY_STORE: "",
      MISTY_CLIENT_ID: "",
      MISTY_CLIENT_SECRET: "",
    });
    expect(stderr).toContain("MISTY_STORE");
    expect(exitCode).toBe(1);
  });

  test("theme --help shows list verb", async () => {
    const { stdout } = await run(["theme", "--help"]);
    expect(stdout).toContain("list");
  });
});
