import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolve } from "path";
import type { Server } from "bun";

const BIN = resolve(import.meta.dir, "../bin/misty.ts");

const MOCK_FILES = [
  {
    node: {
      id: "gid://shopify/MediaImage/1",
      alt: "Hero banner",
      mediaContentType: "IMAGE",
      fileStatus: "READY",
      image: { url: "https://cdn.shopify.com/hero.jpg" },
      fileSize: "204800",
      createdAt: "2024-01-15T10:00:00Z",
      originalSource: { fileSize: "204800" },
    },
  },
  {
    node: {
      id: "gid://shopify/GenericFile/2",
      alt: "User manual",
      mediaContentType: "GENERIC_FILE",
      fileStatus: "READY",
      image: null,
      url: "https://cdn.shopify.com/manual.pdf",
      fileSize: "1048576",
      createdAt: "2024-02-20T14:30:00Z",
      originalSource: { fileSize: "1048576" },
    },
  },
  {
    node: {
      id: "gid://shopify/Video/3",
      alt: "Product demo",
      mediaContentType: "VIDEO",
      fileStatus: "READY",
      image: null,
      sources: [{ url: "https://cdn.shopify.com/demo.mp4" }],
      fileSize: "5242880",
      createdAt: "2024-03-10T08:15:00Z",
      originalSource: { fileSize: "5242880" },
    },
  },
];

function makeFilesResponse(
  edges = MOCK_FILES,
  hasNextPage = false,
  endCursor = "cursor-abc",
) {
  return {
    data: {
      files: {
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

      if (query.includes("files")) {
        const variables = lastRequestBody.variables;

        // Type filtering
        if (variables?.query && variables.query.includes("media_type:")) {
          const typeMatch = variables.query.match(/media_type:(\w+)/);
          const filterType = typeMatch?.[1];
          const filtered = MOCK_FILES.filter(
            (f) => f.node.mediaContentType === filterType,
          );
          return new Response(
            JSON.stringify(makeFilesResponse(filtered, false, "cursor-filtered")),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        // Pagination
        const hasNext = variables?.after === "get-page-2";
        if (hasNext) {
          return new Response(
            JSON.stringify(
              makeFilesResponse([MOCK_FILES[2]!], false, "cursor-end"),
            ),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify(makeFilesResponse(MOCK_FILES, true, "cursor-page2")),
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

describe("misty file list", () => {
  test("table output shows file info", async () => {
    const { stdout, exitCode } = await run(["file", "list"]);
    expect(stdout).toContain("Hero banner");
    expect(stdout).toContain("IMAGE");
    expect(exitCode).toBe(0);
  });

  test("table output shows column headers", async () => {
    const { stdout } = await run(["file", "list", "--no-color"]);
    expect(stdout).toContain("ID");
    expect(stdout).toContain("Filename");
    expect(stdout).toContain("URL");
    expect(stdout).toContain("Alt");
    expect(stdout).toContain("Type");
  });

  test("table shows pagination hint when more results", async () => {
    const { stdout } = await run(["file", "list"]);
    expect(stdout).toContain("More results available");
    expect(stdout).toContain("--cursor");
    expect(stdout).toContain("cursor-page2");
  });

  test("--json returns data array with pageInfo", async () => {
    const { stdout, exitCode } = await run(["file", "list", "--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.data).toBeArray();
    expect(parsed.data.length).toBe(3);
    expect(parsed.data[0].id).toBe("gid://shopify/MediaImage/1");
    expect(parsed.data[0].alt).toBe("Hero banner");
    expect(parsed.data[0].mediaType).toBe("IMAGE");
    expect(parsed.pageInfo).toEqual({ hasNextPage: true, endCursor: "cursor-page2" });
    expect(exitCode).toBe(0);
  });

  test("--cursor passes cursor to GraphQL query", async () => {
    const { stdout } = await run(["file", "list", "--json", "--cursor", "get-page-2"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.data.length).toBe(1);
    expect(parsed.data[0].mediaType).toBe("VIDEO");
    expect(parsed.pageInfo.hasNextPage).toBe(false);
  });

  test("--limit is passed as variable to GraphQL", async () => {
    await run(["file", "list", "--limit", "10"]);
    expect(lastRequestBody.variables.first).toBe(10);
  });

  test("default limit is 50", async () => {
    await run(["file", "list"]);
    expect(lastRequestBody.variables.first).toBe(50);
  });

  test("--limit is clamped to 250", async () => {
    await run(["file", "list", "--limit", "500"]);
    expect(lastRequestBody.variables.first).toBe(250);
  });

  test("--type IMAGE filters to images only", async () => {
    const { stdout } = await run(["file", "list", "--json", "--type", "IMAGE"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.data.length).toBe(1);
    expect(parsed.data[0].mediaType).toBe("IMAGE");
  });

  test("--type VIDEO filters to videos only", async () => {
    const { stdout } = await run(["file", "list", "--json", "--type", "VIDEO"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.data.length).toBe(1);
    expect(parsed.data[0].mediaType).toBe("VIDEO");
  });

  test("--type GENERIC_FILE filters to generic files", async () => {
    const { stdout } = await run(["file", "list", "--json", "--type", "GENERIC_FILE"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.data.length).toBe(1);
    expect(parsed.data[0].mediaType).toBe("GENERIC_FILE");
  });

  test("invalid --type exits with code 2", async () => {
    const { stderr, exitCode } = await run(["file", "list", "--type", "AUDIO"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid --type");
  });

  test("exits with error when credentials missing", async () => {
    const { stderr, exitCode } = await run(["file", "list"], {
      MISTY_STORE: "",
      MISTY_CLIENT_ID: "",
      MISTY_CLIENT_SECRET: "",
    });
    expect(stderr).toContain("MISTY_STORE");
    expect(exitCode).toBe(1);
  });

  test("file appears in top-level help", async () => {
    const { stdout } = await run(["--help"]);
    expect(stdout).toContain("file");
  });

  test("file --help shows list verb", async () => {
    const { stdout } = await run(["file", "--help"]);
    expect(stdout).toContain("list");
  });
});
