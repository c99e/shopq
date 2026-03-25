import { register } from "../registry";
import { formatError } from "../output";
import { resolveConfig, createClient, ConfigError } from "../graphql";
import type { ParsedArgs } from "../types";

async function handleGql(parsed: ParsedArgs): Promise<void> {
  // Resolve query source
  let query: string | undefined;

  if (parsed.flags.file) {
    // --file mode
    const file = Bun.file(parsed.flags.file);
    if (!(await file.exists())) {
      formatError(`File not found: ${parsed.flags.file}`);
      process.exitCode = 2;
      return;
    }
    query = await file.text();
  } else if (parsed.args[0] === "-") {
    // stdin mode
    query = await new Response(Bun.stdin.stream()).text();
  } else if (parsed.args[0]) {
    // inline query
    query = parsed.args[0];
  }

  if (!query || query.trim() === "") {
    formatError("No query provided. Pass an inline query, use - for stdin, or use --file <path>.");
    process.exitCode = 2;
    return;
  }

  // Parse variables
  let variables: Record<string, unknown> | undefined;
  if (parsed.flags.vars) {
    try {
      variables = JSON.parse(parsed.flags.vars);
    } catch {
      formatError("Invalid JSON for --vars flag.");
      process.exitCode = 2;
      return;
    }
  }

  // Resolve config and create client
  let config;
  try {
    config = resolveConfig(parsed.flags.store);
  } catch (err) {
    if (err instanceof ConfigError) {
      formatError(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const protocol = process.env.MISTY_PROTOCOL === "http" ? "http" : "https";
  const client = createClient({ ...config, protocol });

  const result = await client.rawQuery(query, variables);

  // If there are GraphQL errors, print to stderr and exit 1
  if (result.errors && result.errors.length > 0) {
    process.stderr.write(JSON.stringify(result.errors, null, 2) + "\n");
    process.exitCode = 1;
    return;
  }

  // Output raw response
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

register("gql", "Execute raw GraphQL queries", "_default", {
  description: "Execute a raw GraphQL query or mutation",
  handler: handleGql,
});
