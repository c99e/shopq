import { register } from "../registry";
import { formatError } from "../output";
import { getClient, handleCommandError } from "../helpers";
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
  let client;
  try {
    client = getClient(parsed.flags);
  } catch (err) {
    handleCommandError(err);
    return;
  }

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
