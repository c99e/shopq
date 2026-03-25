import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync } from "fs";

const BIN = resolve(import.meta.dir, "../bin/misty.ts");

// ────────────────────────────────────────────
// Unit tests: .env upsert
// ────────────────────────────────────────────

describe("upsertEnvVar", () => {
  let dir: string;
  let envPath: string;

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), "misty-env-"));
    envPath = resolve(dir, ".env");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("creates .env and writes variable when file does not exist", async () => {
    const { upsertEnvVar } = await import("../src/oauth");
    await upsertEnvVar(envPath, "MISTY_ACCESS_TOKEN", "shpat_new123");
    const content = await Bun.file(envPath).text();
    expect(content).toContain('MISTY_ACCESS_TOKEN="shpat_new123"');
  });

  test("updates existing variable without clobbering others", async () => {
    await Bun.write(envPath, 'FOO="bar"\nMISTY_ACCESS_TOKEN="old"\nBAZ="qux"\n');
    const { upsertEnvVar } = await import("../src/oauth");
    await upsertEnvVar(envPath, "MISTY_ACCESS_TOKEN", "shpat_new456");
    const content = await Bun.file(envPath).text();
    expect(content).toContain('FOO="bar"');
    expect(content).toContain('BAZ="qux"');
    expect(content).toContain('MISTY_ACCESS_TOKEN="shpat_new456"');
    expect(content).not.toContain('"old"');
  });

  test("appends variable when .env exists but key is absent", async () => {
    await Bun.write(envPath, 'FOO="bar"\n');
    const { upsertEnvVar } = await import("../src/oauth");
    await upsertEnvVar(envPath, "MISTY_ACCESS_TOKEN", "shpat_abc");
    const content = await Bun.file(envPath).text();
    expect(content).toContain('FOO="bar"');
    expect(content).toContain('MISTY_ACCESS_TOKEN="shpat_abc"');
  });

  test("handles .env with comments and blank lines", async () => {
    await Bun.write(envPath, '# My config\nFOO="bar"\n\n# Token\nMISTY_ACCESS_TOKEN="old"\n');
    const { upsertEnvVar } = await import("../src/oauth");
    await upsertEnvVar(envPath, "MISTY_ACCESS_TOKEN", "shpat_xyz");
    const content = await Bun.file(envPath).text();
    expect(content).toContain("# My config");
    expect(content).toContain('FOO="bar"');
    expect(content).toContain('MISTY_ACCESS_TOKEN="shpat_xyz"');
    expect(content).not.toContain('"old"');
  });
});

// ────────────────────────────────────────────
// Unit tests: state validation
// ────────────────────────────────────────────

describe("validateState", () => {
  test("accepts matching state", async () => {
    const { validateState } = await import("../src/oauth");
    expect(() => validateState("abc123", "abc123")).not.toThrow();
  });

  test("rejects mismatched state", async () => {
    const { validateState } = await import("../src/oauth");
    expect(() => validateState("abc123", "xyz789")).toThrow("state");
  });
});

// ────────────────────────────────────────────
// Unit tests: buildAuthorizeUrl
// ────────────────────────────────────────────

describe("buildAuthorizeUrl", () => {
  test("builds correct authorize URL with all parameters", async () => {
    const { buildAuthorizeUrl } = await import("../src/oauth");
    const url = buildAuthorizeUrl("test.myshopify.com", "my_cid", "http://localhost:3000/callback", "nonce123");
    expect(url).toContain("https://test.myshopify.com/admin/oauth/authorize");
    expect(url).toContain("client_id=my_cid");
    expect(url).toContain("redirect_uri=");
    expect(url).toContain("state=nonce123");
    expect(url).toContain("scope=");
  });
});

// ────────────────────────────────────────────
// Integration tests: CLI arg validation
// ────────────────────────────────────────────

describe("misty auth login", () => {
  let tmpDir: string;

  beforeAll(() => {
    // Use a temp dir as cwd so Bun doesn't auto-load the project .env
    tmpDir = mkdtempSync(resolve(tmpdir(), "misty-auth-cli-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function run(args: string[], env?: Record<string, string>) {
    const proc = Bun.spawn(["bun", BIN, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: tmpDir,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  }

  test("errors when client_id is missing", async () => {
    const { stderr, exitCode } = await run(["auth", "login"]);
    expect(stderr).toContain("client_id");
    expect(exitCode).toBe(2);
  });

  test("errors when client_secret is missing", async () => {
    const { stderr, exitCode } = await run(["auth", "login", "my_client_id"]);
    expect(stderr).toContain("client_secret");
    expect(exitCode).toBe(2);
  });

  test("errors when store is missing", async () => {
    const { stderr, exitCode } = await run(["auth", "login", "my_client_id", "my_secret"]);
    expect(stderr).toContain("store");
    expect(exitCode).toBe(2);
  });

  test("auth appears in top-level help", async () => {
    const { stdout } = await run(["--help"]);
    expect(stdout).toContain("auth");
  });
});

// ────────────────────────────────────────────
// Integration tests: OAuth token exchange
// ────────────────────────────────────────────

describe("OAuth flow", () => {
  let mockShopify: ReturnType<typeof Bun.serve>;
  let mockPort: number;
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(resolve(tmpdir(), "misty-oauth-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    mockShopify?.stop(true);
  });

  function startMockShopify(handler: (req: Request) => Response | Promise<Response>) {
    mockShopify = Bun.serve({ port: 0, fetch: handler });
    mockPort = mockShopify.port;
  }

  test("completes flow and writes token to .env", async () => {
    const envPath = resolve(dir, ".env-flow");
    await Bun.write(envPath, 'EXISTING="keep"\n');

    startMockShopify(async (req: Request) => {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/access_token") && req.method === "POST") {
        const body = (await req.json()) as { client_id: string; client_secret: string; code: string };
        if (body.code === "test_auth_code" && body.client_id === "cid" && body.client_secret === "csec") {
          return new Response(JSON.stringify({ access_token: "shpat_fromflow" }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 });
      }
      return new Response("Not found", { status: 404 });
    });

    const { runOAuthFlow } = await import("../src/oauth");
    await runOAuthFlow({
      clientId: "cid",
      clientSecret: "csec",
      store: "test.myshopify.com",
      envPath,
      oauthBaseUrl: `http://localhost:${mockPort}`,
      onAuthorizeUrl: () => {},
      injectCode: "test_auth_code",
    });

    const envContent = await Bun.file(envPath).text();
    expect(envContent).toContain('EXISTING="keep"');
    expect(envContent).toContain('MISTY_ACCESS_TOKEN="shpat_fromflow"');
  });

  test("reports error on failed token exchange", async () => {
    startMockShopify(async () => {
      return new Response(JSON.stringify({ error: "invalid_client" }), { status: 400 });
    });

    const { runOAuthFlow } = await import("../src/oauth");
    const envPath = resolve(dir, ".env-fail");

    await expect(
      runOAuthFlow({
        clientId: "bad_cid",
        clientSecret: "bad_csec",
        store: "test.myshopify.com",
        envPath,
        oauthBaseUrl: `http://localhost:${mockPort}`,
        onAuthorizeUrl: () => {},
        injectCode: "bad_code",
      }),
    ).rejects.toThrow();
  });

  test("exchangeToken sends correct payload", async () => {
    let captured: any;
    startMockShopify(async (req: Request) => {
      captured = await req.json();
      return new Response(JSON.stringify({ access_token: "shpat_ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const { exchangeToken } = await import("../src/oauth");
    const token = await exchangeToken({
      store: "test.myshopify.com",
      clientId: "cid",
      clientSecret: "csec",
      code: "the_code",
      oauthBaseUrl: `http://localhost:${mockPort}`,
    });

    expect(token).toBe("shpat_ok");
    expect(captured.client_id).toBe("cid");
    expect(captured.client_secret).toBe("csec");
    expect(captured.code).toBe("the_code");
  });
});
