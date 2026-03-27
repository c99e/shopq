import type { GraphQLClient } from "../graphql";
import {
	clampLimit,
	getClient,
	handleCommandError,
	readFileJson,
} from "../helpers";
import { formatError, formatOutput } from "../output";
import { register } from "../registry";
import type { ParsedArgs } from "../types";

const PRODUCTS_QUERY = `query ProductList($first: Int!, $after: String, $sortKey: ProductSortKeys, $query: String) {
  products(first: $first, after: $after, sortKey: $sortKey, query: $query) {
    edges {
      node {
        id
        title
        status
        productType
        vendor
        variantsCount { count }
        totalInventory
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

interface ProductNode {
	id: string;
	title: string;
	status: string;
	productType: string;
	vendor: string;
	variantsCount: { count: number };
	totalInventory: number;
}

interface ProductsResponse {
	products: {
		edges: Array<{ node: ProductNode }>;
		pageInfo: { hasNextPage: boolean; endCursor: string };
	};
}

function buildQueryFilter(flags: ParsedArgs["flags"]): string | undefined {
	const parts: string[] = [];
	if (flags.status) parts.push(`status:${flags.status}`);
	if (flags.type) parts.push(`product_type:${flags.type}`);
	if (flags.vendor) parts.push(`vendor:${flags.vendor}`);
	return parts.length > 0 ? parts.join(" ") : undefined;
}

async function handleProductList(parsed: ParsedArgs): Promise<void> {
	try {
		const client = getClient(parsed.flags);

		const limit = clampLimit(parsed.flags.limit);

		const variables: Record<string, unknown> = {
			first: limit,
			sortKey: "TITLE",
			query: buildQueryFilter(parsed.flags),
		};

		if (parsed.flags.cursor) {
			variables.after = parsed.flags.cursor;
		}

		const result = await client.query<ProductsResponse>(
			PRODUCTS_QUERY,
			variables,
		);
		const products = result.products.edges.map((e) => ({
			id: e.node.id,
			title: e.node.title,
			status: e.node.status,
			productType: e.node.productType,
			vendor: e.node.vendor,
			variantsCount: e.node.variantsCount.count,
			totalInventory: e.node.totalInventory,
		}));

		const pageInfo = result.products.pageInfo;

		if (parsed.flags.json) {
			formatOutput(products, [], {
				json: true,
				noColor: parsed.flags.noColor,
				pageInfo,
			});
			return;
		}

		const columns = [
			{ key: "id", header: "ID" },
			{ key: "title", header: "Title" },
			{ key: "status", header: "Status" },
			{ key: "productType", header: "Type" },
			{ key: "vendor", header: "Vendor" },
			{ key: "variantsCount", header: "Variants" },
			{ key: "totalInventory", header: "Inventory" },
		];

		formatOutput(products, columns, {
			json: false,
			noColor: parsed.flags.noColor,
			pageInfo,
		});
	} catch (err) {
		handleCommandError(err);
	}
}

const PRODUCT_GET_QUERY = `query ProductGet($id: ID!) {
  product(id: $id) {
    id
    title
    status
    productType
    vendor
    tags
    descriptionHtml
    variants(first: 100) {
      edges {
        node {
          id
          sku
          price
          selectedOptions { name value }
          inventoryQuantity
        }
      }
    }
    images(first: 20) {
      edges {
        node {
          url
          altText
        }
      }
    }
  }
}`;

const PRODUCT_SEARCH_QUERY = `query ProductSearch($query: String!) {
  products(first: 10, query: $query) {
    edges {
      node {
        id
        title
        status
      }
    }
  }
}`;

interface ProductGetResponse {
	product: {
		id: string;
		title: string;
		status: string;
		productType: string;
		vendor: string;
		tags: string[];
		descriptionHtml: string;
		variants: {
			edges: Array<{
				node: {
					id: string;
					sku: string;
					price: string;
					selectedOptions: Array<{ name: string; value: string }>;
					inventoryQuantity: number;
				};
			}>;
		};
		images: {
			edges: Array<{
				node: {
					url: string;
					altText: string | null;
				};
			}>;
		};
	} | null;
}

interface ProductSearchResponse {
	products: {
		edges: Array<{
			node: { id: string; title: string; status: string };
		}>;
	};
}

function resolveProductId(
	input: string,
): { type: "gid"; id: string } | { type: "title"; title: string } {
	if (input.startsWith("gid://")) {
		return { type: "gid", id: input };
	}
	if (/^\d+$/.test(input)) {
		return { type: "gid", id: `gid://shopify/Product/${input}` };
	}
	return { type: "title", title: input };
}

function stripHtml(html: string): string {
	return html.replace(/<[^>]*>/g, "").trim();
}

function truncate(str: string, max: number): string {
	if (str.length <= max) return str;
	return `${str.slice(0, max - 3)}...`;
}

async function handleProductGet(parsed: ParsedArgs): Promise<void> {
	const idOrTitle = parsed.args.join(" ");
	if (!idOrTitle) {
		formatError("Usage: shopq product get <id-or-title>");
		process.exitCode = 2;
		return;
	}

	try {
		const client = getClient(parsed.flags);

		const resolved = resolveProductId(idOrTitle);

		if (resolved.type === "gid") {
			// Direct lookup by ID
			const result = await client.query<ProductGetResponse>(PRODUCT_GET_QUERY, {
				id: resolved.id,
			});
			if (!result.product) {
				formatError(`Product "${idOrTitle}" not found`);
				process.exitCode = 1;
				return;
			}
			outputProduct(result.product, parsed);
		} else {
			// Title search
			const searchResult = await client.query<ProductSearchResponse>(
				PRODUCT_SEARCH_QUERY,
				{
					query: `title:${resolved.title}`,
				},
			);
			const matches = searchResult.products.edges;

			if (matches.length === 0) {
				formatError(`Product "${idOrTitle}" not found`);
				process.exitCode = 1;
				return;
			}

			if (matches.length > 1) {
				// Disambiguation
				const columns = [
					{ key: "id", header: "ID" },
					{ key: "title", header: "Title" },
					{ key: "status", header: "Status" },
				];
				const candidates = matches.map((e) => e.node);
				formatOutput(candidates, columns, {
					json: false,
					noColor: parsed.flags.noColor,
				});
				process.exitCode = 1;
				return;
			}

			// Single match — fetch full product
			const productId = matches[0]!.node.id;
			const result = await client.query<ProductGetResponse>(PRODUCT_GET_QUERY, {
				id: productId,
			});
			if (!result.product) {
				formatError(`Product "${idOrTitle}" not found`);
				process.exitCode = 1;
				return;
			}
			outputProduct(result.product, parsed);
		}
	} catch (err) {
		handleCommandError(err);
	}
}

function outputProduct(
	product: NonNullable<ProductGetResponse["product"]>,
	parsed: ParsedArgs,
): void {
	const variants = product.variants.edges.map((e) => ({
		sku: e.node.sku,
		price: e.node.price,
		options: e.node.selectedOptions
			.map((o) => `${o.name}: ${o.value}`)
			.join(", "),
		inventoryQuantity: e.node.inventoryQuantity,
	}));

	const images = product.images.edges.map((e) => ({
		url: e.node.url,
		alt: e.node.altText ?? "",
	}));

	if (parsed.flags.json) {
		const data = {
			id: product.id,
			title: product.title,
			status: product.status,
			productType: product.productType,
			vendor: product.vendor,
			tags: product.tags,
			description: stripHtml(product.descriptionHtml),
			variants: product.variants.edges.map((e) => ({
				id: e.node.id,
				sku: e.node.sku,
				price: e.node.price,
				options: e.node.selectedOptions,
				inventoryQuantity: e.node.inventoryQuantity,
			})),
			images,
		};
		formatOutput(data, [], { json: true, noColor: parsed.flags.noColor });
		return;
	}

	// Key-value table output
	const plainDesc = stripHtml(product.descriptionHtml);
	const lines: string[] = [];
	const label = (name: string) =>
		parsed.flags.noColor ? name : `\x1b[1m${name}\x1b[0m`;

	lines.push(`${label("ID")}: ${product.id}`);
	lines.push(`${label("Title")}: ${product.title}`);
	lines.push(`${label("Status")}: ${product.status}`);
	lines.push(`${label("Type")}: ${product.productType}`);
	lines.push(`${label("Vendor")}: ${product.vendor}`);
	lines.push(`${label("Tags")}: ${product.tags.join(", ")}`);
	lines.push(`${label("Description")}: ${truncate(plainDesc, 80)}`);

	lines.push("");
	lines.push(`${label("Variants")}:`);
	for (const v of variants) {
		lines.push(
			`  SKU: ${v.sku}  Price: ${v.price}  Options: ${v.options}  Qty: ${v.inventoryQuantity}`,
		);
	}

	lines.push("");
	lines.push(`${label("Images")}:`);
	for (const img of images) {
		lines.push(`  ${img.url}${img.alt ? ` (${img.alt})` : ""}`);
	}

	process.stdout.write(`${lines.join("\n")}\n`);
}

// --- product create ---

const PRODUCT_CREATE_MUTATION = `mutation ProductCreate($input: ProductInput!) {
  productCreate(input: $input) {
    product { id }
    userErrors { field message }
  }
}`;

const PRODUCT_OPTIONS_CREATE_MUTATION = `mutation ProductOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
  productOptionsCreate(productId: $productId, options: $options) {
    product { id }
    userErrors { field message }
  }
}`;

const PRODUCT_VARIANTS_BULK_CREATE_MUTATION = `mutation ProductVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkCreate(productId: $productId, variants: $variants) {
    productVariants { id }
    userErrors { field message }
  }
}`;

const PRODUCT_DELETE_MUTATION = `mutation ProductDelete($input: ProductDeleteInput!) {
  productDelete(input: $input) {
    deletedProductId
    userErrors { field message }
  }
}`;

interface UserError {
	field: string[];
	message: string;
}

async function handleProductCreate(parsed: ParsedArgs): Promise<void> {
	const { flags } = parsed;

	// Validate required flags
	if (!flags.title) {
		formatError("Missing required flag: --title");
		process.exitCode = 2;
		return;
	}

	if (flags.variants && !flags.options) {
		formatError("--options is required when --variants is provided");
		process.exitCode = 2;
		return;
	}

	// Validate variants file early, before any API calls
	let variantsJson: any = null;
	if (flags.variants) {
		variantsJson = await readFileJson(flags.variants);
		if (variantsJson === null) return;
	}

	try {
		const client = getClient(flags);

		const status = flags.status ? flags.status.toUpperCase() : "DRAFT";

		const input: Record<string, unknown> = {
			title: flags.title,
			status,
		};
		if (flags.handle) input.handle = flags.handle;
		if (flags.type) input.productType = flags.type;
		if (flags.vendor) input.vendor = flags.vendor;
		if (flags.tags) input.tags = flags.tags.split(",").map((t) => t.trim());
		if (flags.description) input.descriptionHtml = flags.description;

		// Step 1: Create product
		const createResult = await client.query<{
			productCreate: {
				product: { id: string } | null;
				userErrors: UserError[];
			};
		}>(PRODUCT_CREATE_MUTATION, { input });

		if (createResult.productCreate.userErrors.length > 0) {
			formatError(
				createResult.productCreate.userErrors.map((e) => e.message).join("; "),
			);
			process.exitCode = 1;
			return;
		}

		const productId = createResult.productCreate.product!.id;

		// Single-variant (no --variants) — done
		if (!flags.variants) {
			const data = { productId };
			if (flags.json) {
				formatOutput(data, [], { json: true, noColor: flags.noColor });
			} else {
				process.stdout.write(`Created product: ${productId}\n`);
			}
			return;
		}

		// Multi-variant flow
		const optionNames = flags.options!.split(",").map((o) => o.trim());

		// Step 2: Create options
		const optionsInput = optionNames.map((name) => ({
			name,
			values: [{ name: "Default" }],
		}));
		const optionsResult = await client.query<{
			productOptionsCreate: {
				product: { id: string } | null;
				userErrors: UserError[];
			};
		}>(PRODUCT_OPTIONS_CREATE_MUTATION, { productId, options: optionsInput });

		if (optionsResult.productOptionsCreate.userErrors.length > 0) {
			// Rollback
			await rollbackProduct(client, productId);
			formatError(
				`Option creation failed, rollback performed: ${optionsResult.productOptionsCreate.userErrors.map((e) => e.message).join("; ")}`,
			);
			process.exitCode = 1;
			return;
		}

		// Step 3: Bulk create variants
		const variantsResult = await client.query<{
			productVariantsBulkCreate: {
				productVariants: Array<{ id: string }> | null;
				userErrors: UserError[];
			};
		}>(PRODUCT_VARIANTS_BULK_CREATE_MUTATION, {
			productId,
			variants: variantsJson,
		});

		if (variantsResult.productVariantsBulkCreate.userErrors.length > 0) {
			// Rollback
			await rollbackProduct(client, productId);
			formatError(
				`Variant creation failed, rollback performed: ${variantsResult.productVariantsBulkCreate.userErrors.map((e) => e.message).join("; ")}`,
			);
			process.exitCode = 1;
			return;
		}

		const variantIds = (
			variantsResult.productVariantsBulkCreate.productVariants ?? []
		).map((v) => v.id);
		const data = { productId, variantIds };

		if (flags.json) {
			formatOutput(data, [], { json: true, noColor: flags.noColor });
		} else {
			process.stdout.write(`Created product: ${productId}\n`);
			process.stdout.write(`Created variants: ${variantIds.join(", ")}\n`);
		}
	} catch (err) {
		handleCommandError(err);
	}
}

async function rollbackProduct(
	client: GraphQLClient,
	productId: string,
): Promise<void> {
	try {
		await client.query(PRODUCT_DELETE_MUTATION, { input: { id: productId } });
	} catch {
		// Best-effort rollback
	}
}

// --- product update ---

const PRODUCT_UPDATE_MUTATION = `mutation ProductUpdate($input: ProductInput!) {
  productUpdate(input: $input) {
    product { id title status productType vendor }
    userErrors { field message }
  }
}`;

const UPDATE_FLAGS = [
	"title",
	"description",
	"type",
	"vendor",
	"tags",
	"status",
] as const;

async function handleProductUpdate(parsed: ParsedArgs): Promise<void> {
	const idOrTitle = parsed.args.join(" ");
	if (!idOrTitle) {
		formatError(
			"Usage: shopq product update <id-or-title> [--title ...] [--status ...] ...",
		);
		process.exitCode = 2;
		return;
	}

	// Check at least one update flag is provided
	const hasUpdateFlag = UPDATE_FLAGS.some((f) => parsed.flags[f] !== undefined);
	if (!hasUpdateFlag) {
		formatError(
			"Provide at least one update flag: --title, --description, --type, --vendor, --tags, --status",
		);
		process.exitCode = 2;
		return;
	}

	try {
		const client = getClient(parsed.flags);

		// Resolve product ID
		const resolved = resolveProductId(idOrTitle);
		let productGid: string;

		if (resolved.type === "gid") {
			productGid = resolved.id;
		} else {
			const searchResult = await client.query<ProductSearchResponse>(
				PRODUCT_SEARCH_QUERY,
				{
					query: `title:${resolved.title}`,
				},
			);
			const matches = searchResult.products.edges;
			if (matches.length === 0) {
				formatError(`Product "${idOrTitle}" not found`);
				process.exitCode = 1;
				return;
			}
			if (matches.length > 1) {
				const columns = [
					{ key: "id", header: "ID" },
					{ key: "title", header: "Title" },
					{ key: "status", header: "Status" },
				];
				formatOutput(
					matches.map((e) => e.node),
					columns,
					{ json: false, noColor: parsed.flags.noColor },
				);
				process.exitCode = 1;
				return;
			}
			productGid = matches[0]!.node.id;
		}

		// Build input with only provided fields
		const input: Record<string, unknown> = { id: productGid };
		if (parsed.flags.title !== undefined) input.title = parsed.flags.title;
		if (parsed.flags.description !== undefined)
			input.descriptionHtml = parsed.flags.description;
		if (parsed.flags.type !== undefined) input.productType = parsed.flags.type;
		if (parsed.flags.vendor !== undefined) input.vendor = parsed.flags.vendor;
		if (parsed.flags.tags !== undefined)
			input.tags = parsed.flags.tags.split(",").map((t: string) => t.trim());
		if (parsed.flags.status !== undefined)
			input.status = parsed.flags.status.toUpperCase();

		const result = await client.query<{
			productUpdate: {
				product: {
					id: string;
					title: string;
					status: string;
					productType: string;
					vendor: string;
				} | null;
				userErrors: UserError[];
			};
		}>(PRODUCT_UPDATE_MUTATION, { input });

		if (result.productUpdate.userErrors.length > 0) {
			formatError(
				result.productUpdate.userErrors.map((e) => e.message).join("; "),
			);
			process.exitCode = 1;
			return;
		}

		const product = result.productUpdate.product!;

		if (parsed.flags.json) {
			formatOutput(product, [], { json: true, noColor: parsed.flags.noColor });
		} else {
			const label = (name: string) =>
				parsed.flags.noColor ? name : `\x1b[1m${name}\x1b[0m`;
			const lines = [
				`${label("ID")}: ${product.id}`,
				`${label("Title")}: ${product.title}`,
				`${label("Status")}: ${product.status}`,
				`${label("Type")}: ${product.productType}`,
				`${label("Vendor")}: ${product.vendor}`,
			];
			process.stdout.write(`${lines.join("\n")}\n`);
		}
	} catch (err) {
		handleCommandError(err);
	}
}

// --- product delete ---

const PRODUCT_SUMMARY_QUERY = `query ProductSummary($id: ID!) {
  product(id: $id) {
    id
    title
  }
}`;

interface ProductSummaryResponse {
	product: { id: string; title: string } | null;
}

async function handleProductDelete(parsed: ParsedArgs): Promise<void> {
	const idOrTitle = parsed.args.join(" ");
	if (!idOrTitle) {
		formatError("Usage: shopq product delete <id-or-title> [--yes]");
		process.exitCode = 2;
		return;
	}

	try {
		const client = getClient(parsed.flags);

		// Resolve product ID
		const resolved = resolveProductId(idOrTitle);
		let productGid: string;
		let productTitle: string;

		if (resolved.type === "gid") {
			// Fetch product summary to get title
			const result = await client.query<ProductSummaryResponse>(
				PRODUCT_SUMMARY_QUERY,
				{ id: resolved.id },
			);
			if (!result.product) {
				formatError(`Product "${idOrTitle}" not found`);
				process.exitCode = 1;
				return;
			}
			productGid = result.product.id;
			productTitle = result.product.title;
		} else {
			// Title search
			const searchResult = await client.query<ProductSearchResponse>(
				PRODUCT_SEARCH_QUERY,
				{
					query: `title:${resolved.title}`,
				},
			);
			const matches = searchResult.products.edges;
			if (matches.length === 0) {
				formatError(`Product "${idOrTitle}" not found`);
				process.exitCode = 1;
				return;
			}
			if (matches.length > 1) {
				const columns = [
					{ key: "id", header: "ID" },
					{ key: "title", header: "Title" },
					{ key: "status", header: "Status" },
				];
				formatOutput(
					matches.map((e) => e.node),
					columns,
					{ json: false, noColor: parsed.flags.noColor },
				);
				process.exitCode = 1;
				return;
			}
			productGid = matches[0]!.node.id;
			productTitle = matches[0]!.node.title;
		}

		// Dry run — no --yes
		if (!parsed.flags.yes) {
			const data = { id: productGid, title: productTitle };
			if (parsed.flags.json) {
				formatOutput(data, [], { json: true, noColor: parsed.flags.noColor });
			} else {
				process.stdout.write(
					`Would delete product: ${productTitle} (${productGid})\n`,
				);
			}
			return;
		}

		// Execute delete
		const result = await client.query<{
			productDelete: {
				deletedProductId: string | null;
				userErrors: UserError[];
			};
		}>(PRODUCT_DELETE_MUTATION, { input: { id: productGid } });

		if (result.productDelete.userErrors.length > 0) {
			formatError(
				result.productDelete.userErrors.map((e) => e.message).join("; "),
			);
			process.exitCode = 1;
			return;
		}

		const data = { id: productGid, title: productTitle };
		if (parsed.flags.json) {
			formatOutput(data, [], { json: true, noColor: parsed.flags.noColor });
		} else {
			process.stdout.write(
				`Deleted product: ${productTitle} (${productGid})\n`,
			);
		}
	} catch (err) {
		handleCommandError(err);
	}
}

register("product", "Product management", "delete", {
	description: "Delete a product by ID or title",
	handler: handleProductDelete,
});

register("product", "Product management", "update", {
	description: "Update a product by ID or title",
	handler: handleProductUpdate,
});

register("product", "Product management", "create", {
	description: "Create a product with optional variant support",
	handler: handleProductCreate,
});

register("product", "Product management", "list", {
	description: "List products with filtering and pagination",
	handler: handleProductList,
});

register("product", "Product management", "get", {
	description: "Get a single product by ID or title",
	handler: handleProductGet,
});
