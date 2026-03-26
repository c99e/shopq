import { describe, test, expect } from "bun:test";
import { resolve } from "path";

const BIN = resolve(import.meta.dir, "../bin/shopctl.ts");

async function run(args: string[], env?: Record<string, string>) {
  const proc = Bun.spawn(["bun", BIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("shopctl config show", () => {
  const validEnv = {
    SHOPIFY_STORE: "my-store.myshopify.com",
    SHOPIFY_CLIENT_ID: "client-id-abcdef1234567890",
    SHOPIFY_CLIENT_SECRET: "client-secret-abcdef1234567890",
  };

  test("prints store domain in table output", async () => {
    const { stdout, exitCode } = await run(["config", "show"], validEnv);
    expect(stdout).toContain("my-store.myshopify.com");
    expect(exitCode).toBe(0);
  });

  test("prints API version in table output", async () => {
    const { stdout } = await run(["config", "show"], validEnv);
    expect(stdout).toContain("2026-01");
  });

  test("never prints full client ID in stdout", async () => {
    const { stdout } = await run(["config", "show"], validEnv);
    expect(stdout).not.toContain("client-id-abcdef1234567890");
  });

  test("never prints full client secret in stdout", async () => {
    const { stdout } = await run(["config", "show"], validEnv);
    expect(stdout).not.toContain("client-secret-abcdef1234567890");
  });

  test("masks the client ID showing only last 4 chars", async () => {
    const { stdout } = await run(["config", "show"], validEnv);
    expect(stdout).toContain("****7890");
  });

  test("masks the client secret showing only last 4 chars", async () => {
    const { stdout } = await run(["config", "show"], validEnv);
    expect(stdout).toContain("****7890");
  });

  test("--json outputs valid JSON with data envelope", async () => {
    const { stdout, exitCode } = await run(["config", "show", "--json"], validEnv);
    const parsed = JSON.parse(stdout);
    expect(parsed.data).toBeDefined();
    expect(parsed.data.store).toBe("my-store.myshopify.com");
    expect(parsed.data.apiVersion).toBe("2026-01");
    expect(exitCode).toBe(0);
  });

  test("--json output masks client ID", async () => {
    const { stdout } = await run(["config", "show", "--json"], validEnv);
    const parsed = JSON.parse(stdout);
    expect(parsed.data.clientId).not.toBe("client-id-abcdef1234567890");
    expect(parsed.data.clientId).toContain("****");
  });

  test("--json output masks client secret", async () => {
    const { stdout } = await run(["config", "show", "--json"], validEnv);
    const parsed = JSON.parse(stdout);
    expect(parsed.data.clientSecret).not.toBe("client-secret-abcdef1234567890");
    expect(parsed.data.clientSecret).toContain("****");
  });

  test("exits with error when SHOPIFY_STORE is missing", async () => {
    const { stderr, exitCode } = await run(["config", "show"], {
      SHOPIFY_STORE: "",
      SHOPIFY_CLIENT_ID: "id",
      SHOPIFY_CLIENT_SECRET: "secret",
    });
    expect(stderr).toContain("SHOPIFY_STORE");
    expect(exitCode).toBe(1);
  });

  test("exits with error when SHOPIFY_CLIENT_ID is missing", async () => {
    const { stderr, exitCode } = await run(["config", "show"], {
      SHOPIFY_STORE: "my-store.myshopify.com",
      SHOPIFY_CLIENT_ID: "",
      SHOPIFY_CLIENT_SECRET: "secret",
    });
    expect(stderr).toContain("SHOPIFY_CLIENT_ID");
    expect(exitCode).toBe(1);
  });

  test("exits with error when SHOPIFY_CLIENT_SECRET is missing", async () => {
    const { stderr, exitCode } = await run(["config", "show"], {
      SHOPIFY_STORE: "my-store.myshopify.com",
      SHOPIFY_CLIENT_ID: "id",
      SHOPIFY_CLIENT_SECRET: "",
    });
    expect(stderr).toContain("SHOPIFY_CLIENT_SECRET");
    expect(exitCode).toBe(1);
  });

  test("exits with error naming all missing vars when all absent", async () => {
    const { stderr, exitCode } = await run(["config", "show"], {
      SHOPIFY_STORE: "",
      SHOPIFY_CLIENT_ID: "",
      SHOPIFY_CLIENT_SECRET: "",
    });
    expect(stderr).toContain("SHOPIFY_STORE");
    expect(stderr).toContain("SHOPIFY_CLIENT_ID");
    expect(stderr).toContain("SHOPIFY_CLIENT_SECRET");
    expect(exitCode).toBe(1);
  });

  test("errors go to stderr, not stdout", async () => {
    const { stdout, stderr } = await run(["config", "show"], {
      SHOPIFY_STORE: "",
      SHOPIFY_CLIENT_ID: "",
      SHOPIFY_CLIENT_SECRET: "",
    });
    expect(stdout).toBe("");
    expect(stderr).not.toBe("");
  });

  test("config appears in top-level help", async () => {
    const { stdout } = await run(["--help"], validEnv);
    expect(stdout).toContain("config");
  });

  test("config --help shows verb list", async () => {
    const { stdout, exitCode } = await run(["config", "--help"], validEnv);
    expect(stdout).toContain("show");
    expect(exitCode).toBe(0);
  });
});
