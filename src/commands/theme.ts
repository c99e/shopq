import { register } from "../registry";
import { formatOutput, formatError } from "../output";
import { resolveConfig, createClient, ConfigError, GraphQLError } from "../graphql";
import type { ParsedArgs } from "../types";

const THEMES_LIST_QUERY = `query ThemeList {
  themes(first: 250) {
    edges {
      node {
        id
        name
        role
        createdAt
        updatedAt
      }
    }
  }
}`;

interface Theme {
  id: string;
  name: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

function extractNumericId(gid: string): string {
  const match = gid.match(/(\d+)$/);
  return match ? match[1] : gid;
}

async function handleThemeList(parsed: ParsedArgs): Promise<void> {
  try {
    const config = resolveConfig(parsed.flags.store);
    const protocol = process.env.MISTY_PROTOCOL === "http" ? "http" : "https";
    const client = createClient({ ...config, protocol });

    const result = await client.query<{
      themes: { edges: Array<{ node: Theme }> };
    }>(THEMES_LIST_QUERY, {});

    const themes = result.themes.edges.map((e) => e.node);

    if (parsed.flags.json) {
      const data = themes.map((t) => ({
        id: t.id,
        numericId: extractNumericId(t.id),
        name: t.name,
        role: t.role,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }));
      formatOutput(data, [], { json: true, noColor: parsed.flags.noColor });
      return;
    }

    // Table output
    const label = (name: string) =>
      parsed.flags.noColor ? name : `\x1b[1m${name}\x1b[0m`;
    const lines: string[] = [];

    for (let i = 0; i < themes.length; i++) {
      const theme = themes[i]!;
      if (i > 0) lines.push("");
      lines.push(`${label("ID")}: ${theme.id}`);
      lines.push(`${label("Numeric ID")}: ${extractNumericId(theme.id)}`);
      lines.push(`${label("Name")}: ${theme.name}`);
      lines.push(`${label("Role")}: ${theme.role}`);
      lines.push(`${label("Created")}: ${theme.createdAt}`);
      lines.push(`${label("Updated")}: ${theme.updatedAt}`);
    }

    process.stdout.write(lines.join("\n") + "\n");
  } catch (err) {
    if (err instanceof ConfigError) {
      formatError(err.message);
      process.exitCode = 1;
      return;
    }
    if (err instanceof GraphQLError) {
      formatError(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

register("theme", "Theme management", "list", {
  description: "List all themes",
  handler: handleThemeList,
});
