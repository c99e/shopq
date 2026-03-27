import { clampLimit, getClient, handleCommandError } from "../helpers";
import { formatError, formatOutput } from "../output";
import { register } from "../registry";
import type { ParsedArgs } from "../types";

const COLLECTION_GET_BY_ID_QUERY = `query CollectionGet($id: ID!) {
  collection(id: $id) {
    id
    title
    handle
    descriptionHtml
    productsCount { count precision }
    image { url altText }
    seo { title description }
  }
}`;

const COLLECTION_GET_BY_HANDLE_QUERY = `query CollectionGetByHandle($handle: String!) {
  collectionByHandle(handle: $handle) {
    id
    title
    handle
    descriptionHtml
    productsCount { count precision }
    image { url altText }
    seo { title description }
  }
}`;

interface CollectionNode {
	id: string;
	title: string;
	handle: string;
	descriptionHtml: string;
	productsCount: { count: number; precision: string };
	image: { url: string; altText: string | null } | null;
	seo: { title: string; description: string };
}

function resolveCollectionInput(
	input: string,
): { type: "gid"; id: string } | { type: "handle"; handle: string } {
	if (input.startsWith("gid://")) {
		return { type: "gid", id: input };
	}
	if (/^\d+$/.test(input)) {
		return { type: "gid", id: `gid://shopify/Collection/${input}` };
	}
	return { type: "handle", handle: input };
}

function stripHtml(html: string): string {
	return html.replace(/<[^>]*>/g, "").trim();
}

function truncate(str: string, max: number): string {
	if (str.length <= max) return str;
	return `${str.slice(0, max - 3)}...`;
}

async function handleCollectionGet(parsed: ParsedArgs): Promise<void> {
	const idOrHandle = parsed.args.join(" ");
	if (!idOrHandle) {
		formatError("Usage: shopctl collection get <id-or-handle>");
		process.exitCode = 2;
		return;
	}

	try {
		const client = getClient(parsed.flags);

		const resolved = resolveCollectionInput(idOrHandle);
		let collection: CollectionNode | null = null;

		if (resolved.type === "gid") {
			const result = await client.query<{ collection: CollectionNode | null }>(
				COLLECTION_GET_BY_ID_QUERY,
				{ id: resolved.id },
			);
			collection = result.collection;
		} else {
			const result = await client.query<{
				collectionByHandle: CollectionNode | null;
			}>(COLLECTION_GET_BY_HANDLE_QUERY, { handle: resolved.handle });
			collection = result.collectionByHandle;
		}

		if (!collection) {
			formatError(`Collection "${idOrHandle}" not found`);
			process.exitCode = 1;
			return;
		}

		if (parsed.flags.json) {
			const data = {
				id: collection.id,
				title: collection.title,
				handle: collection.handle,
				description: stripHtml(collection.descriptionHtml),
				productsCount: collection.productsCount,
				image: collection.image
					? { url: collection.image.url, alt: collection.image.altText ?? "" }
					: null,
				seo: collection.seo,
			};
			formatOutput(data, [], { json: true, noColor: parsed.flags.noColor });
			return;
		}

		// Key-value table output
		const label = (name: string) =>
			parsed.flags.noColor ? name : `\x1b[1m${name}\x1b[0m`;
		const lines: string[] = [];

		lines.push(`${label("ID")}: ${collection.id}`);
		lines.push(`${label("Title")}: ${collection.title}`);
		lines.push(`${label("Handle")}: ${collection.handle}`);
		lines.push(`${label("Products Count")}: ${collection.productsCount.count}`);
		lines.push(
			`${label("Description")}: ${truncate(stripHtml(collection.descriptionHtml), 80)}`,
		);

		if (collection.image) {
			lines.push(
				`${label("Image")}: ${collection.image.url}${collection.image.altText ? ` (${collection.image.altText})` : ""}`,
			);
		}

		lines.push(`${label("SEO Title")}: ${collection.seo.title}`);
		lines.push(`${label("SEO Description")}: ${collection.seo.description}`);

		process.stdout.write(`${lines.join("\n")}\n`);
	} catch (err) {
		handleCommandError(err);
	}
}

const COLLECTIONS_QUERY = `query CollectionList($first: Int!, $after: String) {
  collections(first: $first, after: $after) {
    edges {
      node {
        id
        title
        handle
        descriptionHtml
        productsCount { count precision }
        image { url altText }
        seo { title description }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

interface CollectionsResponse {
	collections: {
		edges: Array<{ node: CollectionNode }>;
		pageInfo: { hasNextPage: boolean; endCursor: string };
	};
}

async function handleCollectionList(parsed: ParsedArgs): Promise<void> {
	try {
		const client = getClient(parsed.flags);

		const limit = clampLimit(parsed.flags.limit);

		const variables: Record<string, unknown> = { first: limit };
		if (parsed.flags.cursor) {
			variables.after = parsed.flags.cursor;
		}

		const result = await client.query<CollectionsResponse>(
			COLLECTIONS_QUERY,
			variables,
		);
		const collections = result.collections.edges.map((e) => ({
			id: e.node.id,
			title: e.node.title,
			handle: e.node.handle,
			description: stripHtml(e.node.descriptionHtml),
			productsCount: parsed.flags.json
				? e.node.productsCount
				: e.node.productsCount.count,
			image: e.node.image
				? { url: e.node.image.url, alt: e.node.image.altText ?? "" }
				: null,
			seo: e.node.seo,
		}));

		const pageInfo = result.collections.pageInfo;

		if (parsed.flags.json) {
			formatOutput(collections, [], {
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
			{ key: "productsCount", header: "Products" },
			{ key: "image", header: "Image", format: (v: any) => (v ? "Yes" : "No") },
			{ key: "description", header: "Description" },
		];

		formatOutput(collections, columns, {
			json: false,
			noColor: parsed.flags.noColor,
			pageInfo,
		});
	} catch (err) {
		handleCommandError(err);
	}
}

register("collection", "Collection management", "list", {
	description: "List collections with pagination",
	handler: handleCollectionList,
});

register("collection", "Collection management", "get", {
	description: "Get a single collection by ID or handle",
	handler: handleCollectionGet,
});
