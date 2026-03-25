import { register } from "../registry";
import { formatOutput, formatError } from "../output";
import { resolveConfig, createClient, ConfigError, GraphQLError } from "../graphql";
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
    const config = resolveConfig(parsed.flags.store);
    const protocol = process.env.MISTY_PROTOCOL === "http" ? "http" : "https";
    const client = createClient({ ...config, protocol });

    let limit = parsed.flags.limit ? parseInt(parsed.flags.limit, 10) : 50;
    if (limit > 250) limit = 250;

    const variables: Record<string, unknown> = {
      first: limit,
      sortKey: "TITLE",
      query: buildQueryFilter(parsed.flags),
    };

    if (parsed.flags.cursor) {
      variables.after = parsed.flags.cursor;
    }

    const result = await client.query<ProductsResponse>(PRODUCTS_QUERY, variables);
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
      formatOutput(products, [], { json: true, noColor: parsed.flags.noColor, pageInfo });
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

    formatOutput(products, columns, { json: false, noColor: parsed.flags.noColor, pageInfo });
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

function resolveProductId(input: string): { type: "gid"; id: string } | { type: "title"; title: string } {
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
  return str.slice(0, max - 3) + "...";
}

async function handleProductGet(parsed: ParsedArgs): Promise<void> {
  const idOrTitle = parsed.args.join(" ");
  if (!idOrTitle) {
    formatError("Usage: misty product get <id-or-title>");
    process.exitCode = 1;
    return;
  }

  try {
    const config = resolveConfig(parsed.flags.store);
    const protocol = process.env.MISTY_PROTOCOL === "http" ? "http" : "https";
    const client = createClient({ ...config, protocol });

    const resolved = resolveProductId(idOrTitle);

    if (resolved.type === "gid") {
      // Direct lookup by ID
      const result = await client.query<ProductGetResponse>(PRODUCT_GET_QUERY, { id: resolved.id });
      if (!result.product) {
        formatError(`Product "${idOrTitle}" not found`);
        process.exitCode = 1;
        return;
      }
      outputProduct(result.product, parsed);
    } else {
      // Title search
      const searchResult = await client.query<ProductSearchResponse>(PRODUCT_SEARCH_QUERY, {
        query: `title:${resolved.title}`,
      });
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
        formatOutput(candidates, columns, { json: false, noColor: parsed.flags.noColor });
        process.exitCode = 1;
        return;
      }

      // Single match — fetch full product
      const productId = matches[0]!.node.id;
      const result = await client.query<ProductGetResponse>(PRODUCT_GET_QUERY, { id: productId });
      if (!result.product) {
        formatError(`Product "${idOrTitle}" not found`);
        process.exitCode = 1;
        return;
      }
      outputProduct(result.product, parsed);
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

function outputProduct(product: NonNullable<ProductGetResponse["product"]>, parsed: ParsedArgs): void {
  const variants = product.variants.edges.map((e) => ({
    sku: e.node.sku,
    price: e.node.price,
    options: e.node.selectedOptions.map((o) => `${o.name}: ${o.value}`).join(", "),
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
  const label = (name: string) => parsed.flags.noColor ? name : `\x1b[1m${name}\x1b[0m`;

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
    lines.push(`  SKU: ${v.sku}  Price: ${v.price}  Options: ${v.options}  Qty: ${v.inventoryQuantity}`);
  }

  lines.push("");
  lines.push(`${label("Images")}:`);
  for (const img of images) {
    lines.push(`  ${img.url}${img.alt ? ` (${img.alt})` : ""}`);
  }

  process.stdout.write(lines.join("\n") + "\n");
}

register("product", "Product management", "list", {
  description: "List products with filtering and pagination",
  handler: handleProductList,
});

register("product", "Product management", "get", {
  description: "Get a single product by ID or title",
  handler: handleProductGet,
});
