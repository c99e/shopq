import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";

// We'll test the helpers module once it exists
import { getClient, handleCommandError, clampLimit } from "../src/helpers";
import { ConfigError, GraphQLError } from "../src/graphql";

describe("getClient", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.MISTY_STORE = "test.myshopify.com";
    process.env.MISTY_ACCESS_TOKEN = "shpat_test123";
    delete process.env.MISTY_PROTOCOL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("returns a GraphQL client with https by default", () => {
    const client = getClient({});
    expect(client).toBeDefined();
    expect(typeof client.query).toBe("function");
    expect(typeof client.rawQuery).toBe("function");
  });

  test("uses store flag over env var", () => {
    // Should not throw when store flag is provided even if env is missing
    delete process.env.MISTY_STORE;
    const client = getClient({ store: "flag-store.myshopify.com" });
    expect(client).toBeDefined();
  });

  test("throws ConfigError when store and token are missing", () => {
    delete process.env.MISTY_STORE;
    delete process.env.MISTY_ACCESS_TOKEN;
    expect(() => getClient({})).toThrow(ConfigError);
  });

  test("uses http protocol when MISTY_PROTOCOL=http", () => {
    process.env.MISTY_PROTOCOL = "http";
    // Should not throw — just verify it creates a client
    const client = getClient({});
    expect(client).toBeDefined();
  });

  test("defaults to https when MISTY_PROTOCOL is something else", () => {
    process.env.MISTY_PROTOCOL = "ftp";
    const client = getClient({});
    expect(client).toBeDefined();
  });
});

describe("handleCommandError", () => {
  let stderrOutput: string;
  const originalWrite = process.stderr.write;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    stderrOutput = "";
    process.stderr.write = ((chunk: any) => {
      stderrOutput += String(chunk);
      return true;
    }) as any;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
    process.exitCode = originalExitCode;
  });

  test("handles ConfigError with stderr output and exit code 1", () => {
    const err = new ConfigError(["MISTY_STORE", "MISTY_ACCESS_TOKEN"]);
    handleCommandError(err);
    expect(stderrOutput).toContain("Error:");
    expect(stderrOutput).toContain("MISTY_STORE");
    expect(process.exitCode).toBe(1);
  });

  test("handles GraphQLError with stderr output and exit code 1", () => {
    const err = new GraphQLError([{ message: "Something went wrong" }]);
    handleCommandError(err);
    expect(stderrOutput).toContain("Error:");
    expect(stderrOutput).toContain("Something went wrong");
    expect(process.exitCode).toBe(1);
  });

  test("rethrows unknown errors", () => {
    const err = new Error("unexpected");
    expect(() => handleCommandError(err)).toThrow("unexpected");
  });

  test("rethrows non-Error values", () => {
    expect(() => handleCommandError("string error")).toThrow();
  });
});

describe("clampLimit", () => {
  let stderrOutput: string;
  const originalWrite = process.stderr.write;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    stderrOutput = "";
    process.stderr.write = ((chunk: any) => {
      stderrOutput += String(chunk);
      return true;
    }) as any;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
    process.exitCode = originalExitCode;
  });

  test("returns default (50) when value is undefined", () => {
    expect(clampLimit(undefined)).toBe(50);
  });

  test("parses and returns valid limit", () => {
    expect(clampLimit("25")).toBe(25);
  });

  test("clamps to 1 when value is 0", () => {
    expect(clampLimit("0")).toBe(1);
    expect(stderrOutput).toContain("--limit");
  });

  test("clamps to 1 when value is negative", () => {
    expect(clampLimit("-1")).toBe(1);
    expect(stderrOutput).toContain("--limit");
  });

  test("clamps to 250 when value exceeds maximum", () => {
    expect(clampLimit("999")).toBe(250);
    expect(stderrOutput).toContain("--limit");
  });

  test("returns 1 for minimum valid value", () => {
    expect(clampLimit("1")).toBe(1);
  });

  test("returns 250 for maximum valid value", () => {
    expect(clampLimit("250")).toBe(250);
  });

  test("clamps NaN input to 1 and warns", () => {
    expect(clampLimit("abc")).toBe(1);
    expect(stderrOutput).toContain("--limit");
  });
});
