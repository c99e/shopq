import {
	clampLimit,
	getClient,
	handleCommandError,
	readFileText,
} from "../helpers";
import { formatError, formatOutput } from "../output";
import { register } from "../registry";
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
		formatError(
			"--body and --body-file are mutually exclusive; provide only one",
		);
		process.exitCode = 2;
		return;
	}

	try {
		const client = getClient(flags);

		const page: Record<string, unknown> = {
			title: flags.title,
			isPublished: flags.published === "true",
		};

		if (flags.handle) page.handle = flags.handle;

		// Body: inline or from file
		if (flags.body) {
			page.body = flags.body;
		} else if (flags["body-file"]) {
			const bodyContent = await readFileText(flags["body-file"]);
			if (bodyContent === null) return;
			page.body = bodyContent;
		}

		// SEO metafields
		const metafields: Array<{
			namespace: string;
			key: string;
			type: string;
			value: string;
		}> = [];
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
			formatError(
				result.pageCreate.userErrors.map((e) => e.message).join("; "),
			);
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
		handleCommandError(err);
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

function extractSeo(metafields: { edges: Array<{ node: MetafieldNode }> }): {
	title: string | null;
	description: string | null;
} {
	let title: string | null = null;
	let description: string | null = null;
	for (const { node } of metafields.edges) {
		if (node.namespace === "global" && node.key === "title_tag")
			title = node.value;
		if (node.namespace === "global" && node.key === "description_tag")
			description = node.value;
	}
	return { title, description };
}

async function handlePageList(parsed: ParsedArgs): Promise<void> {
	try {
		const client = getClient(parsed.flags);

		const limit = clampLimit(parsed.flags.limit);

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
			formatOutput(pages, [], {
				json: true,
				noColor: parsed.flags.noColor,
				pageInfo,
			});
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

		formatOutput(tableData, columns, {
			json: false,
			noColor: parsed.flags.noColor,
			pageInfo,
		});
	} catch (err) {
		handleCommandError(err);
	}
}

const PAGE_FIELDS = `
    id
    title
    handle
    isPublished
    body
    createdAt
    updatedAt
    metafields(first: 10, namespace: "global") {
      edges {
        node {
          namespace
          key
          value
        }
      }
    }`;

const PAGE_GET_BY_ID_QUERY = `query PageGetById($id: ID!) {
  page(id: $id) {
    ${PAGE_FIELDS}
  }
}`;

const PAGE_GET_BY_HANDLE_QUERY = `query PageGetByHandle($query: String!) {
  pages(first: 1, query: $query) {
    edges {
      node {
        ${PAGE_FIELDS}
      }
    }
  }
}`;

interface PageFull {
	id: string;
	title: string;
	handle: string;
	isPublished: boolean;
	body: string;
	createdAt: string;
	updatedAt: string;
	metafields: { edges: Array<{ node: MetafieldNode }> };
}

function resolvePageId(
	input: string,
): { type: "gid"; id: string } | { type: "handle"; handle: string } {
	if (input.startsWith("gid://")) {
		return { type: "gid", id: input };
	}
	if (/^\d+$/.test(input)) {
		return { type: "gid", id: `gid://shopify/Page/${input}` };
	}
	return { type: "handle", handle: input };
}

async function handlePageGet(parsed: ParsedArgs): Promise<void> {
	const idOrHandle = parsed.args.join(" ");
	if (!idOrHandle) {
		formatError("Usage: shopq page get <id-or-handle>");
		process.exitCode = 2;
		return;
	}

	try {
		const client = getClient(parsed.flags);

		const resolved = resolvePageId(idOrHandle);
		let page: PageFull | null = null;

		if (resolved.type === "gid") {
			const result = await client.query<{ page: PageFull | null }>(
				PAGE_GET_BY_ID_QUERY,
				{ id: resolved.id },
			);
			page = result.page;
		} else {
			const result = await client.query<{
				pages: { edges: Array<{ node: PageFull }> };
			}>(PAGE_GET_BY_HANDLE_QUERY, { query: `handle:${resolved.handle}` });
			page = result.pages.edges[0]?.node ?? null;
		}

		if (!page) {
			formatError(`Page "${idOrHandle}" not found`);
			process.exitCode = 1;
			return;
		}
		const seo = extractSeo(page.metafields);

		if (parsed.flags.json) {
			const data = {
				id: page.id,
				title: page.title,
				handle: page.handle,
				published: page.isPublished,
				body: page.body,
				seo,
				createdAt: page.createdAt,
				updatedAt: page.updatedAt,
			};
			formatOutput(data, [], { json: true, noColor: parsed.flags.noColor });
			return;
		}

		// Key-value table output
		const label = (name: string) =>
			parsed.flags.noColor ? name : `\x1b[1m${name}\x1b[0m`;
		const lines: string[] = [];
		lines.push(`${label("ID")}: ${page.id}`);
		lines.push(`${label("Title")}: ${page.title}`);
		lines.push(`${label("Handle")}: ${page.handle}`);
		lines.push(`${label("Published")}: ${page.isPublished}`);
		lines.push(`${label("SEO Title")}: ${seo.title ?? ""}`);
		lines.push(`${label("SEO Description")}: ${seo.description ?? ""}`);
		lines.push(`${label("Created")}: ${page.createdAt}`);
		lines.push(`${label("Updated")}: ${page.updatedAt}`);
		lines.push("");
		lines.push(`${label("Body")}:`);
		lines.push(page.body);

		process.stdout.write(`${lines.join("\n")}\n`);
	} catch (err) {
		handleCommandError(err);
	}
}

register("page", "Page management", "get", {
	description: "Get a single page by handle",
	handler: handlePageGet,
});

register("page", "Page management", "list", {
	description: "List static store pages",
	handler: handlePageList,
});

register("page", "Page management", "create", {
	description: "Create a static store page",
	handler: handlePageCreate,
});

const PAGE_LOOKUP_QUERY = `query PageLookup($query: String!) {
  pages(first: 1, query: $query) {
    edges {
      node { id }
    }
  }
}`;

const PAGE_UPDATE_MUTATION = `mutation PageUpdate($id: ID!, $page: PageUpdateInput!) {
  pageUpdate(id: $id, page: $page) {
    page { id }
    userErrors { field message }
  }
}`;

async function handlePageUpdate(parsed: ParsedArgs): Promise<void> {
	const { flags } = parsed;
	const handle = parsed.args.join(" ");

	if (!handle) {
		formatError("Usage: shopq page update <handle>");
		process.exitCode = 2;
		return;
	}

	if (flags.body && flags["body-file"]) {
		formatError(
			"--body and --body-file are mutually exclusive; provide only one",
		);
		process.exitCode = 2;
		return;
	}

	// Build update input and track which fields are being updated
	const page: Record<string, unknown> = {};
	const updatedFields: string[] = [];

	if (flags.title) {
		page.title = flags.title;
		updatedFields.push("title");
	}

	if (flags.body) {
		page.body = flags.body;
		updatedFields.push("body");
	} else if (flags["body-file"]) {
		const bodyContent = await readFileText(flags["body-file"]);
		if (bodyContent === null) return;
		page.body = bodyContent;
		updatedFields.push("body");
	}

	const metafields: Array<{
		namespace: string;
		key: string;
		type: string;
		value: string;
	}> = [];
	if (flags["seo-title"]) {
		metafields.push({
			namespace: "global",
			key: "title_tag",
			type: "single_line_text_field",
			value: flags["seo-title"],
		});
		updatedFields.push("seo_title");
	}
	if (flags["seo-desc"]) {
		metafields.push({
			namespace: "global",
			key: "description_tag",
			type: "single_line_text_field",
			value: flags["seo-desc"],
		});
		updatedFields.push("seo_desc");
	}
	if (metafields.length > 0) {
		page.metafields = metafields;
	}

	if (updatedFields.length === 0) {
		formatError(
			"No update flags provided; at least one of --title, --body, --body-file, --seo-title, --seo-desc is required",
		);
		process.exitCode = 2;
		return;
	}

	try {
		const client = getClient(flags);

		// Look up page by handle
		const lookup = await client.query<{
			pages: { edges: Array<{ node: { id: string } }> };
		}>(PAGE_LOOKUP_QUERY, { query: `handle:${handle}` });

		const foundPage = lookup.pages.edges[0]?.node;
		if (!foundPage) {
			formatError(`Page "${handle}" not found`);
			process.exitCode = 1;
			return;
		}

		const pageId = foundPage.id;

		const result = await client.query<{
			pageUpdate: {
				page: { id: string } | null;
				userErrors: UserError[];
			};
		}>(PAGE_UPDATE_MUTATION, { id: pageId, page });

		if (result.pageUpdate.userErrors.length > 0) {
			formatError(
				result.pageUpdate.userErrors.map((e) => e.message).join("; "),
			);
			process.exitCode = 1;
			return;
		}

		if (flags.json) {
			formatOutput(updatedFields, [], { json: true, noColor: flags.noColor });
		} else {
			process.stdout.write(`Updated fields: ${updatedFields.join(", ")}\n`);
		}
	} catch (err) {
		handleCommandError(err);
	}
}

register("page", "Page management", "update", {
	description: "Update a static store page",
	handler: handlePageUpdate,
});

// --- page delete ---

const PAGE_SUMMARY_BY_ID_QUERY = `query PageSummary($id: ID!) {
  page(id: $id) {
    id
    title
  }
}`;

const PAGE_SUMMARY_BY_HANDLE_QUERY = `query PageSummaryByHandle($query: String!) {
  pages(first: 1, query: $query) {
    edges {
      node {
        id
        title
      }
    }
  }
}`;

const PAGE_DELETE_MUTATION = `mutation PageDelete($id: ID!) {
  pageDelete(id: $id) {
    deletedPageId
    userErrors { field message }
  }
}`;

async function handlePageDelete(parsed: ParsedArgs): Promise<void> {
	const idOrHandle = parsed.args.join(" ");
	if (!idOrHandle) {
		formatError("Usage: shopq page delete <id-or-handle> [--yes]");
		process.exitCode = 2;
		return;
	}

	try {
		const client = getClient(parsed.flags);

		const resolved = resolvePageId(idOrHandle);
		let pageGid: string;
		let pageTitle: string;

		if (resolved.type === "gid") {
			const result = await client.query<{
				page: { id: string; title: string } | null;
			}>(PAGE_SUMMARY_BY_ID_QUERY, { id: resolved.id });
			if (!result.page) {
				formatError(`Page "${idOrHandle}" not found`);
				process.exitCode = 1;
				return;
			}
			pageGid = result.page.id;
			pageTitle = result.page.title;
		} else {
			const result = await client.query<{
				pages: { edges: Array<{ node: { id: string; title: string } }> };
			}>(PAGE_SUMMARY_BY_HANDLE_QUERY, { query: `handle:${resolved.handle}` });
			const found = result.pages.edges[0]?.node;
			if (!found) {
				formatError(`Page "${idOrHandle}" not found`);
				process.exitCode = 1;
				return;
			}
			pageGid = found.id;
			pageTitle = found.title;
		}

		// Dry run — no --yes
		if (!parsed.flags.yes) {
			const data = { id: pageGid, title: pageTitle };
			if (parsed.flags.json) {
				formatOutput(data, [], { json: true, noColor: parsed.flags.noColor });
			} else {
				process.stdout.write(`Would delete page: ${pageTitle} (${pageGid})\n`);
			}
			return;
		}

		// Execute delete
		const result = await client.query<{
			pageDelete: { deletedPageId: string | null; userErrors: UserError[] };
		}>(PAGE_DELETE_MUTATION, { id: pageGid });

		if (result.pageDelete.userErrors.length > 0) {
			formatError(
				result.pageDelete.userErrors.map((e) => e.message).join("; "),
			);
			process.exitCode = 1;
			return;
		}

		const data = { id: pageGid, title: pageTitle };
		if (parsed.flags.json) {
			formatOutput(data, [], { json: true, noColor: parsed.flags.noColor });
		} else {
			process.stdout.write(`Deleted page: ${pageTitle} (${pageGid})\n`);
		}
	} catch (err) {
		handleCommandError(err);
	}
}

register("page", "Page management", "delete", {
	description: "Delete a page by ID or handle",
	handler: handlePageDelete,
});
