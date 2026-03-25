import { describe, test, expect } from "bun:test";
import { parseArgs } from "../src/parse";
import type { ParsedArgs } from "../src/types";

describe("parseArgs", () => {
  test("parses resource and verb", () => {
    const result = parseArgs(["product", "list"]);
    expect(result.resource).toBe("product");
    expect(result.verb).toBe("list");
    expect(result.args).toEqual([]);
  });

  test("parses resource only", () => {
    const result = parseArgs(["product"]);
    expect(result.resource).toBe("product");
    expect(result.verb).toBeUndefined();
  });

  test("parses empty args", () => {
    const result = parseArgs([]);
    expect(result.resource).toBeUndefined();
    expect(result.verb).toBeUndefined();
  });

  test("parses positional args after resource and verb", () => {
    const result = parseArgs(["product", "get", "123"]);
    expect(result.resource).toBe("product");
    expect(result.verb).toBe("get");
    expect(result.args).toEqual(["123"]);
  });

  test("parses --version flag", () => {
    const result = parseArgs(["--version"]);
    expect(result.flags.version).toBe(true);
  });

  test("parses -v short flag", () => {
    const result = parseArgs(["-v"]);
    expect(result.flags.version).toBe(true);
  });

  test("parses --help flag", () => {
    const result = parseArgs(["--help"]);
    expect(result.flags.help).toBe(true);
  });

  test("parses -h short flag", () => {
    const result = parseArgs(["-h"]);
    expect(result.flags.help).toBe(true);
  });

  test("parses --json flag", () => {
    const result = parseArgs(["product", "list", "--json"]);
    expect(result.flags.json).toBe(true);
  });

  test("parses -j short flag", () => {
    const result = parseArgs(["product", "list", "-j"]);
    expect(result.flags.json).toBe(true);
  });

  test("parses --no-color flag", () => {
    const result = parseArgs(["--no-color"]);
    expect(result.flags.noColor).toBe(true);
  });

  test("parses --store flag with space-separated value", () => {
    const result = parseArgs(["--store", "mystore.myshopify.com", "product", "list"]);
    expect(result.flags.store).toBe("mystore.myshopify.com");
    expect(result.resource).toBe("product");
    expect(result.verb).toBe("list");
  });

  test("parses --store=value form", () => {
    const result = parseArgs(["--store=mystore.myshopify.com"]);
    expect(result.flags.store).toBe("mystore.myshopify.com");
  });

  test("respects NO_COLOR env var", () => {
    const origNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "";
    try {
      const result = parseArgs([]);
      expect(result.flags.noColor).toBe(true);
    } finally {
      if (origNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = origNoColor;
      }
    }
  });

  test("--help after resource is still parsed", () => {
    const result = parseArgs(["product", "--help"]);
    expect(result.resource).toBe("product");
    expect(result.flags.help).toBe(true);
  });

  test("flags mixed with positional args", () => {
    const result = parseArgs(["--json", "product", "list", "--store", "x.myshopify.com"]);
    expect(result.flags.json).toBe(true);
    expect(result.flags.store).toBe("x.myshopify.com");
    expect(result.resource).toBe("product");
    expect(result.verb).toBe("list");
  });

  test("known resource flags are parsed into flags", () => {
    const result = parseArgs(["product", "list", "--status", "active"]);
    expect(result.resource).toBe("product");
    expect(result.verb).toBe("list");
    expect(result.flags.status).toBe("active");
    expect(result.args).toEqual([]);
  });

  test("unknown flags are passed through in args", () => {
    const result = parseArgs(["product", "list", "--unknown", "value"]);
    expect(result.resource).toBe("product");
    expect(result.verb).toBe("list");
    expect(result.args).toEqual(["--unknown", "value"]);
  });
});
