import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolve } from "path";
import type { Server } from "bun";

const BIN = resolve(import.meta.dir, "../bin/misty.ts");

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

const MOCK_MENU = {
  id: "gid://shopify/Menu/123",
  title: "Main Menu",
  handle: "main-menu",
  itemsCount: { count: 3 },
  items: [MOCK_MENU_ITEM],
};

function makeMockServer(handler: (body: any) => any) {
  return Bun.serve({
    port: 0,
    fetch: async (req) => {
      const body = await req.json();
      const result = handler(body);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
}

let mockServer: Server;
let mockPort: number;

beforeAll(() => {
  mockServer = makeMockServer((body) => {
    const query = body.query as string;
    const variables = body.variables;

    // menu by ID
    if (query.includes("menu(id:") || query.includes("$id: ID!")) {
      if (variables.id === "gid://shopify/Menu/123") {
        return { data: { menu: MOCK_MENU } };
      }
      return { data: { menu: null } };
    }

    // menu by handle
    if (query.includes("menuByHandle") || query.includes("$handle: String!")) {
      if (variables.handle === "main-menu") {
        return { data: { menuByHandle: MOCK_MENU } };
      }
      return { data: { menuByHandle: null } };
    }

    return { data: {} };
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

describe("misty menu get", () => {
  test("lookup by numeric ID returns menu", async () => {
    const { stdout, exitCode } = await run(["menu", "get", "123"]);
    expect(stdout).toContain("Main Menu");
    expect(exitCode).toBe(0);
  });

  test("lookup by full GID returns menu", async () => {
    const { stdout, exitCode } = await run(["menu", "get", "gid://shopify/Menu/123"]);
    expect(stdout).toContain("Main Menu");
    expect(exitCode).toBe(0);
  });

  test("lookup by handle returns menu", async () => {
    const { stdout, exitCode } = await run(["menu", "get", "main-menu"]);
    expect(stdout).toContain("Main Menu");
    expect(exitCode).toBe(0);
  });

  test("table output shows nested items with indentation", async () => {
    const { stdout } = await run(["menu", "get", "123"]);
    expect(stdout).toContain("Home");
    expect(stdout).toContain("About");
    expect(stdout).toContain("Team");
    // Indentation check
    expect(stdout).toMatch(/  About/);
    expect(stdout).toMatch(/    Team/);
  });

  test("--json returns data envelope with full nested tree", async () => {
    const { stdout, exitCode } = await run(["menu", "get", "123", "--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.data).toBeDefined();
    expect(parsed.data.id).toBe("gid://shopify/Menu/123");
    expect(parsed.data.title).toBe("Main Menu");
    expect(parsed.data.handle).toBe("main-menu");
    expect(parsed.data.items).toBeArray();
    expect(parsed.data.items[0].title).toBe("Home");
    expect(parsed.data.items[0].items[0].title).toBe("About");
    expect(parsed.data.items[0].items[0].items[0].title).toBe("Team");
    expect(exitCode).toBe(0);
  });

  test("not found by ID returns error and exit code 1", async () => {
    const { stderr, exitCode } = await run(["menu", "get", "999"]);
    expect(stderr).toContain("not found");
    expect(exitCode).toBe(1);
  });

  test("not found by handle returns error and exit code 1", async () => {
    const { stderr, exitCode } = await run(["menu", "get", "nonexistent-handle"]);
    expect(stderr).toContain("not found");
    expect(exitCode).toBe(1);
  });

  test("missing argument shows usage error", async () => {
    const { stderr, exitCode } = await run(["menu", "get"]);
    expect(stderr).toContain("Usage");
    expect(exitCode).toBe(1);
  });
});
