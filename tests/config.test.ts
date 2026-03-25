import { describe, test, expect } from "bun:test";
import { resolve } from "path";

const BIN = resolve(import.meta.dir, "../bin/misty.ts");

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

describe("misty config show", () => {
  const validEnv = {
    MISTY_STORE: "my-store.myshopify.com",
    MISTY_ACCESS_TOKEN: "shpat_abcdef1234567890",
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

  test("never prints full access token in stdout", async () => {
    const { stdout } = await run(["config", "show"], validEnv);
    expect(stdout).not.toContain("shpat_abcdef1234567890");
  });

  test("masks the access token showing only last 4 chars", async () => {
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

  test("--json output masks access token", async () => {
    const { stdout } = await run(["config", "show", "--json"], validEnv);
    const parsed = JSON.parse(stdout);
    expect(parsed.data.accessToken).not.toBe("shpat_abcdef1234567890");
    expect(parsed.data.accessToken).toContain("****");
  });

  test("exits with error when MISTY_STORE is missing", async () => {
    const { stderr, exitCode } = await run(["config", "show"], {
      MISTY_ACCESS_TOKEN: "shpat_abc123",
    });
    expect(stderr).toContain("MISTY_STORE");
    expect(exitCode).toBe(1);
  });

  test("exits with error when MISTY_ACCESS_TOKEN is missing", async () => {
    const { stderr, exitCode } = await run(["config", "show"], {
      MISTY_STORE: "my-store.myshopify.com",
    });
    expect(stderr).toContain("MISTY_ACCESS_TOKEN");
    expect(exitCode).toBe(1);
  });

  test("exits with error naming both missing vars when both absent", async () => {
    const { stderr, exitCode } = await run(["config", "show"], {});
    expect(stderr).toContain("MISTY_STORE");
    expect(stderr).toContain("MISTY_ACCESS_TOKEN");
    expect(exitCode).toBe(1);
  });

  test("errors go to stderr, not stdout", async () => {
    const { stdout, stderr } = await run(["config", "show"], {});
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
