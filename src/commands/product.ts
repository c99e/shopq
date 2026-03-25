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

register("product", "Product management", "list", {
  description: "List products with filtering and pagination",
  handler: handleProductList,
});
