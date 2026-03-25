import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { formatOutput, formatError, type OutputOptions, type Column } from "../src/output";

// Capture stdout/stderr
function captureOutput(fn: () => void): { stdout: string; stderr: string } {
  const originalWrite = process.stdout.write;
  const originalErrWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";

  process.stdout.write = ((chunk: any) => {
    stdout += String(chunk);
    return true;
  }) as any;
  process.stderr.write = ((chunk: any) => {
    stderr += String(chunk);
    return true;
  }) as any;

  try {
    fn();
  } finally {
    process.stdout.write = originalWrite;
    process.stderr.write = originalErrWrite;
  }

  return { stdout, stderr };
}

const columns: Column[] = [
  { key: "id", header: "ID" },
  { key: "title", header: "Title" },
  { key: "status", header: "Status" },
];

const sampleData = [
  { id: "1", title: "Widget", status: "active" },
  { id: "2", title: "Gadget", status: "draft" },
];

describe("formatOutput — JSON mode", () => {
  test("renders data envelope to stdout", () => {
    const { stdout, stderr } = captureOutput(() => {
      formatOutput(sampleData, columns, { json: true, noColor: true });
    });
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual({ data: sampleData });
    expect(stderr).toBe("");
  });

  test("includes pageInfo when provided", () => {
    const pageInfo = { hasNextPage: true, endCursor: "abc123" };
    const { stdout } = captureOutput(() => {
      formatOutput(sampleData, columns, { json: true, noColor: true, pageInfo });
    });
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual({ data: sampleData, pageInfo });
  });

  test("omits pageInfo when not provided", () => {
    const { stdout } = captureOutput(() => {
      formatOutput(sampleData, columns, { json: true, noColor: true });
    });
    const parsed = JSON.parse(stdout);
    expect(parsed).not.toHaveProperty("pageInfo");
  });

  test("renders single object data", () => {
    const { stdout } = captureOutput(() => {
      formatOutput({ id: "1", title: "Widget" }, columns, { json: true, noColor: true });
    });
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual({ data: { id: "1", title: "Widget" } });
  });

  test("renders empty array", () => {
    const { stdout } = captureOutput(() => {
      formatOutput([], columns, { json: true, noColor: true });
    });
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual({ data: [] });
  });
});

describe("formatOutput — table mode", () => {
  test("renders formatted table with headers", () => {
    const { stdout, stderr } = captureOutput(() => {
      formatOutput(sampleData, columns, { json: false, noColor: true });
    });
    expect(stdout).toContain("ID");
    expect(stdout).toContain("Title");
    expect(stdout).toContain("Status");
    expect(stdout).toContain("Widget");
    expect(stdout).toContain("Gadget");
    expect(stdout).toContain("active");
    expect(stdout).toContain("draft");
    expect(stderr).toBe("");
  });

  test("columns are aligned", () => {
    const { stdout } = captureOutput(() => {
      formatOutput(sampleData, columns, { json: false, noColor: true });
    });
    const lines = stdout.trim().split("\n");
    // Header and separator and data rows
    expect(lines.length).toBeGreaterThanOrEqual(4); // header + separator + 2 data rows
    // All "ID" column values should start at same position
    const headerIdEnd = lines[0]!.indexOf("ID");
    expect(headerIdEnd).toBeGreaterThanOrEqual(0);
  });

  test("shows pagination hint when hasNextPage is true", () => {
    const pageInfo = { hasNextPage: true, endCursor: "cursor_xyz" };
    const { stdout } = captureOutput(() => {
      formatOutput(sampleData, columns, { json: false, noColor: true, pageInfo });
    });
    expect(stdout).toContain("More results available. Use --cursor cursor_xyz to see next page.");
  });

  test("no pagination hint when hasNextPage is false", () => {
    const pageInfo = { hasNextPage: false, endCursor: "cursor_xyz" };
    const { stdout } = captureOutput(() => {
      formatOutput(sampleData, columns, { json: false, noColor: true, pageInfo });
    });
    expect(stdout).not.toContain("More results available");
  });

  test("no pagination hint when pageInfo is absent", () => {
    const { stdout } = captureOutput(() => {
      formatOutput(sampleData, columns, { json: false, noColor: true });
    });
    expect(stdout).not.toContain("More results available");
  });

  test("renders empty array as just headers", () => {
    const { stdout } = captureOutput(() => {
      formatOutput([], columns, { json: false, noColor: true });
    });
    expect(stdout).toContain("ID");
    expect(stdout).toContain("Title");
    // No data rows beyond header + separator
    const lines = stdout.trim().split("\n");
    expect(lines.length).toBe(2); // header + separator
  });

  test("renders single object as key-value pairs", () => {
    const { stdout } = captureOutput(() => {
      formatOutput({ id: "1", title: "Widget", status: "active" }, columns, { json: false, noColor: true });
    });
    expect(stdout).toContain("ID");
    expect(stdout).toContain("1");
    expect(stdout).toContain("Title");
    expect(stdout).toContain("Widget");
  });
});

describe("formatError", () => {
  test("writes error message to stderr", () => {
    const { stdout, stderr } = captureOutput(() => {
      formatError("something went wrong");
    });
    expect(stderr).toContain("something went wrong");
    expect(stdout).toBe("");
  });

  test("prefixes with Error:", () => {
    const { stderr } = captureOutput(() => {
      formatError("bad input");
    });
    expect(stderr).toContain("Error:");
    expect(stderr).toContain("bad input");
  });
});

describe("color support", () => {
  test("noColor disables any ANSI codes in table output", () => {
    const { stdout } = captureOutput(() => {
      formatOutput(sampleData, columns, { json: false, noColor: true });
    });
    // Should not contain ANSI escape sequences
    expect(stdout).not.toMatch(/\x1b\[/);
  });
});
