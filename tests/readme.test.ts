import { test, expect } from "bun:test";

const readme = await Bun.file("README.md").text();

test("README describes what Mistea is", () => {
  expect(readme).toMatch(/shopify/i);
  expect(readme).toMatch(/cli/i);
});

test("README lists prerequisites", () => {
  expect(readme).toMatch(/bun/i);
  expect(readme).toMatch(/SHOPIFY_STORE/);
  expect(readme).toMatch(/SHOPIFY_CLIENT_ID/);
});

test("README has command reference for all resources", () => {
  for (const resource of ["product", "page", "collection", "menu", "file", "theme", "shop", "config", "gql"]) {
    expect(readme).toContain(resource);
  }
});

test("README includes usage examples", () => {
  // At least 2 code blocks with shopctl commands
  const examples = readme.match(/shopctl \w+ \w+/g) ?? [];
  expect(examples.length).toBeGreaterThanOrEqual(2);
});

test("README mentions how to run tests", () => {
  expect(readme).toContain("bun test");
});

test("README has no bun init boilerplate", () => {
  expect(readme).not.toContain("This project was created using `bun init`");
});
