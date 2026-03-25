import { register } from "../registry";
import { formatOutput, formatError } from "../output";
import { resolveConfig, createClient, ConfigError, GraphQLError } from "../graphql";
import type { ParsedArgs } from "../types";

const PAGE_CREATE_MUTATION = `mutation PageCreate($page: PageCreateInput!) {
  pageCreate(page: $page) {
    page { id handle }
    userErrors { field message }
  }
}`;

interface UserError {
  field: string[];
  message: string;
}

async function handlePageCreate(parsed: ParsedArgs): Promise<void> {
  const { flags } = parsed;

  if (!flags.title) {
    formatError("Missing required flag: --title");
    process.exitCode = 2;
    return;
  }

  if (flags.body && flags["body-file"]) {
    formatError("--body and --body-file are mutually exclusive; provide only one");
    process.exitCode = 2;
    return;
  }

  try {
    const config = resolveConfig(flags.store);
    const protocol = process.env.MISTY_PROTOCOL === "http" ? "http" : "https";
    const client = createClient({ ...config, protocol });

    const page: Record<string, unknown> = {
      title: flags.title,
      isPublished: flags.published === "true",
    };

    if (flags.handle) page.handle = flags.handle;

    // Body: inline or from file
    if (flags.body) {
      page.body = flags.body;
    } else if (flags["body-file"]) {
      page.body = await Bun.file(flags["body-file"]).text();
    }

    // SEO metafields
    const metafields: Array<{ namespace: string; key: string; type: string; value: string }> = [];
    if (flags["seo-title"]) {
      metafields.push({
        namespace: "global",
        key: "title_tag",
        type: "single_line_text_field",
        value: flags["seo-title"],
      });
    }
    if (flags["seo-desc"]) {
      metafields.push({
        namespace: "global",
        key: "description_tag",
        type: "single_line_text_field",
        value: flags["seo-desc"],
      });
    }
    if (metafields.length > 0) {
      page.metafields = metafields;
    }

    const result = await client.query<{
      pageCreate: {
        page: { id: string; handle: string } | null;
        userErrors: UserError[];
      };
    }>(PAGE_CREATE_MUTATION, { page });

    if (result.pageCreate.userErrors.length > 0) {
      formatError(result.pageCreate.userErrors.map((e) => e.message).join("; "));
      process.exitCode = 1;
      return;
    }

    const created = result.pageCreate.page!;
    const data = { id: created.id, handle: created.handle };

    if (flags.json) {
      formatOutput(data, [], { json: true, noColor: flags.noColor });
    } else {
      process.stdout.write(`Created page: ${created.handle} (${created.id})\n`);
    }
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

const PAGES_QUERY = `query PageList($first: Int!, $after: String) {
  pages(first: $first, after: $after) {
    edges {
      node {
        id
        title
        handle
        isPublished
        bodySummary
        createdAt
        metafields(first: 10, namespace: "global") {
          edges {
            node {
              namespace
              key
              value
            }
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

interface MetafieldNode {
  namespace: string;
  key: string;
  value: string;
}

function extractSeo(metafields: { edges: Array<{ node: MetafieldNode }> }): { title: string | null; description: string | null } {
  let title: string | null = null;
  let description: string | null = null;
  for (const { node } of metafields.edges) {
    if (node.namespace === "global" && node.key === "title_tag") title = node.value;
    if (node.namespace === "global" && node.key === "description_tag") description = node.value;
  }
  return { title, description };
}

async function handlePageList(parsed: ParsedArgs): Promise<void> {
  try {
    const config = resolveConfig(parsed.flags.store);
    const protocol = process.env.MISTY_PROTOCOL === "http" ? "http" : "https";
    const client = createClient({ ...config, protocol });

    let limit = parsed.flags.limit ? parseInt(parsed.flags.limit, 10) : 50;
    if (limit > 250) limit = 250;

    const variables: Record<string, unknown> = { first: limit };
    if (parsed.flags.cursor) variables.after = parsed.flags.cursor;

    const result = await client.query<{
      pages: {
        edges: Array<{
          node: {
            id: string;
            title: string;
            handle: string;
            isPublished: boolean;
            bodySummary: string;
            createdAt: string;
            metafields: { edges: Array<{ node: MetafieldNode }> };
          };
        }>;
        pageInfo: { hasNextPage: boolean; endCursor: string };
      };
    }>(PAGES_QUERY, variables);

    const pages = result.pages.edges.map((e) => {
      const seo = extractSeo(e.node.metafields);
      return {
        id: e.node.id,
        title: e.node.title,
        handle: e.node.handle,
        published: e.node.isPublished,
        bodySummary: e.node.bodySummary,
        seo,
        createdAt: e.node.createdAt,
      };
    });

    const pageInfo = result.pages.pageInfo;

    if (parsed.flags.json) {
      formatOutput(pages, [], { json: true, noColor: parsed.flags.noColor, pageInfo });
      return;
    }

    const columns = [
      { key: "id", header: "ID" },
      { key: "title", header: "Title" },
      { key: "handle", header: "Handle" },
      { key: "published", header: "Published" },
      { key: "seoTitle", header: "SEO Title" },
      { key: "createdAt", header: "Created" },
    ];

    const tableData = pages.map((p) => ({
      ...p,
      seoTitle: p.seo.title ?? "",
    }));

    formatOutput(tableData, columns, { json: false, noColor: parsed.flags.noColor, pageInfo });
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

register("page", "Page management", "list", {
  description: "List static store pages",
  handler: handlePageList,
});

register("page", "Page management", "create", {
  description: "Create a static store page",
  handler: handlePageCreate,
});
