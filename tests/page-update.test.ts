import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { mkdtemp, writeFile, rm } from "fs/promises";
import type { Server } from "bun";

const BIN = resolve(import.meta.dir, "../bin/shopctl.ts");

let mockServer: Server;
let mockPort: number;
let allRequests: any[] = [];
let mockResponses: Array<(body: any) => Response | null> = [];
let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "shopctl-page-update-test-"));

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

      for (const handler of mockResponses) {
        const res = handler(body);
        if (res) return res;
      }

      return new Response(JSON.stringify({ data: {} }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  mockPort = mockServer.port;
});

afterAll(async () => {
  mockServer.stop();
  await rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  allRequests = [];
  mockResponses = [];
});

function jsonRes(data: any) {
  return new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
  });
}

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

function mockPageLookupAndUpdate(pageId = "gid://shopify/Page/1001") {
  mockResponses.push((body) => {
    if (body.query.includes("pages(") && body.variables?.query) {
      return jsonRes({
        pages: { edges: [{ node: { id: pageId } }] },
      });
    }
    if (body.query.includes("pageUpdate")) {
      return jsonRes({
        pageUpdate: {
          page: { id: pageId },
          userErrors: [],
        },
      });
    }
    return null;
  });
}

describe("shopctl page update — validation", () => {
  test("exits with code 2 when no update flags are provided", async () => {
    const { stderr, exitCode } = await run(["page", "update", "about-us"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("at least one");
  });

  test("exits with code 1 when handle is missing", async () => {
    const { stderr, exitCode } = await run(["page", "update"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("handle");
  });

  test("exits with code 2 when both --body and --body-file are provided", async () => {
    const { stderr, exitCode } = await run([
      "page", "update", "about-us", "--body", "<p>hi</p>", "--body-file", "some.html",
    ]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("--body");
    expect(stderr).toContain("--body-file");
  });
});

describe("shopctl page update — update body only", () => {
  test("sends only body in the mutation and returns updated fields", async () => {
    mockPageLookupAndUpdate();

    const { stdout, exitCode } = await run([
      "page", "update", "about-us", "--body", "<p>New body</p>", "--json",
    ]);
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed.data).toContain("body");

    // Check mutation only includes body
    const updateReq = allRequests.find((r) => r.query.includes("pageUpdate"));
    expect(updateReq).toBeDefined();
    const input = updateReq.variables.page;
    expect(input.body).toBe("<p>New body</p>");
    expect(input.title).toBeUndefined();
  });
});

describe("shopctl page update — update SEO only", () => {
  test("sends metafields for SEO fields and returns updated field names", async () => {
    mockPageLookupAndUpdate();

    const { stdout, exitCode } = await run([
      "page", "update", "about-us", "--seo-title", "New SEO Title", "--seo-desc", "New SEO Desc", "--json",
    ]);
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed.data).toContain("seo_title");
    expect(parsed.data).toContain("seo_desc");

    const updateReq = allRequests.find((r) => r.query.includes("pageUpdate"));
    const input = updateReq.variables.page;
    expect(input.metafields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          namespace: "global",
          key: "title_tag",
          type: "single_line_text_field",
          value: "New SEO Title",
        }),
        expect.objectContaining({
          namespace: "global",
          key: "description_tag",
          type: "single_line_text_field",
          value: "New SEO Desc",
        }),
      ])
    );
  });
});

describe("shopctl page update — update multiple fields", () => {
  test("sends title and body together, returns both in updated fields", async () => {
    mockPageLookupAndUpdate();

    const { stdout, exitCode } = await run([
      "page", "update", "about-us", "--title", "New Title", "--body", "<p>Updated</p>", "--json",
    ]);
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed.data).toContain("title");
    expect(parsed.data).toContain("body");

    const updateReq = allRequests.find((r) => r.query.includes("pageUpdate"));
    const input = updateReq.variables.page;
    expect(input.title).toBe("New Title");
    expect(input.body).toBe("<p>Updated</p>");
  });
});

describe("shopctl page update — body from file", () => {
  test("reads body from file path", async () => {
    const bodyFile = join(tmpDir, "update-body.html");
    await writeFile(bodyFile, "<h1>From File</h1>");

    mockPageLookupAndUpdate();

    const { stdout, exitCode } = await run([
      "page", "update", "about-us", "--body-file", bodyFile, "--json",
    ]);
    expect(exitCode).toBe(0);

    const updateReq = allRequests.find((r) => r.query.includes("pageUpdate"));
    const input = updateReq.variables.page;
    expect(input.body).toBe("<h1>From File</h1>");
  });
});

describe("shopctl page update — page not found", () => {
  test("exits with code 1 when page handle not found", async () => {
    mockResponses.push((body) => {
      if (body.query.includes("pages(") && body.variables?.query) {
        return jsonRes({ pages: { edges: [] } });
      }
      return null;
    });

    const { stderr, exitCode } = await run([
      "page", "update", "nonexistent", "--title", "New",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });
});

describe("shopctl page update — GraphQL userErrors", () => {
  test("reports userErrors from the mutation", async () => {
    mockResponses.push((body) => {
      if (body.query.includes("pages(") && body.variables?.query) {
        return jsonRes({ pages: { edges: [{ node: { id: "gid://shopify/Page/1001" } }] } });
      }
      if (body.query.includes("pageUpdate")) {
        return jsonRes({
          pageUpdate: {
            page: null,
            userErrors: [{ field: ["title"], message: "Title is invalid" }],
          },
        });
      }
      return null;
    });

    const { stderr, exitCode } = await run([
      "page", "update", "about-us", "--title", "Bad",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Title is invalid");
  });
});

describe("shopctl page update — table output", () => {
  test("prints updated fields without --json", async () => {
    mockPageLookupAndUpdate();

    const { stdout, exitCode } = await run([
      "page", "update", "about-us", "--title", "New Title",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("title");
  });
});

describe("shopctl page update — file-read error handling", () => {
  test("exits with error when --body-file does not exist", async () => {
    const { stderr, exitCode } = await run([
      "page", "update", "about-us",
      "--body-file", "/tmp/nonexistent-body-file-12345.html",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("nonexistent-body-file-12345.html");
    expect(stderr).toMatch(/^Error:/m);
    expect(stderr).not.toContain("ENOENT");
    expect(stderr).not.toContain("syscall");
  });
});
