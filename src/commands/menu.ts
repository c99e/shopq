import { register } from "../registry";
import { formatOutput, formatError } from "../output";
import { resolveConfig, createClient, ConfigError, GraphQLError } from "../graphql";
import type { ParsedArgs } from "../types";

const MENU_ITEMS_FRAGMENT = `
  title
  url
  type
  items {
    title
    url
    type
    items {
      title
      url
      type
      items {
        title
        url
        type
        items {
          title
          url
          type
          items {
            title
            url
            type
          }
        }
      }
    }
  }
`;

const MENU_BY_ID_QUERY = `query MenuGet($id: ID!) {
  menu(id: $id) {
    id
    title
    handle
    itemsCount { count }
    items {
      ${MENU_ITEMS_FRAGMENT}
    }
  }
}`;

const MENU_BY_HANDLE_QUERY = `query MenuGetByHandle($handle: String!) {
  menuByHandle(handle: $handle) {
    id
    title
    handle
    itemsCount { count }
    items {
      ${MENU_ITEMS_FRAGMENT}
    }
  }
}`;

interface MenuItem {
  title: string;
  url: string;
  type: string;
  items?: MenuItem[];
}

interface Menu {
  id: string;
  title: string;
  handle: string;
  itemsCount: { count: number };
  items: MenuItem[];
}

function resolveMenuId(input: string): { type: "gid"; id: string } | { type: "handle"; handle: string } {
  if (input.startsWith("gid://")) {
    return { type: "gid", id: input };
  }
  if (/^\d+$/.test(input)) {
    return { type: "gid", id: `gid://shopify/Menu/${input}` };
  }
  return { type: "handle", handle: input };
}

function flattenItems(items: MenuItem[], depth: number, rows: Array<{ indent: string; title: string; url: string; type: string }>) {
  for (const item of items) {
    rows.push({
      indent: "  ".repeat(depth),
      title: item.title,
      url: item.url,
      type: item.type,
    });
    if (item.items && item.items.length > 0) {
      flattenItems(item.items, depth + 1, rows);
    }
  }
}

async function handleMenuGet(parsed: ParsedArgs): Promise<void> {
  const idOrHandle = parsed.args.join(" ");
  if (!idOrHandle) {
    formatError("Usage: misty menu get <id-or-handle>");
    process.exitCode = 1;
    return;
  }

  try {
    const config = resolveConfig(parsed.flags.store);
    const protocol = process.env.MISTY_PROTOCOL === "http" ? "http" : "https";
    const client = createClient({ ...config, protocol });

    const resolved = resolveMenuId(idOrHandle);
    let menu: Menu | null = null;

    if (resolved.type === "gid") {
      const result = await client.query<{ menu: Menu | null }>(MENU_BY_ID_QUERY, { id: resolved.id });
      menu = result.menu;
    } else {
      const result = await client.query<{ menuByHandle: Menu | null }>(MENU_BY_HANDLE_QUERY, { handle: resolved.handle });
      menu = result.menuByHandle;
    }

    if (!menu) {
      formatError(`Menu "${idOrHandle}" not found`);
      process.exitCode = 1;
      return;
    }

    if (parsed.flags.json) {
      const data = {
        id: menu.id,
        title: menu.title,
        handle: menu.handle,
        itemsCount: menu.itemsCount.count,
        items: menu.items,
      };
      formatOutput(data, [], { json: true, noColor: parsed.flags.noColor });
      return;
    }

    // Table output: key-value header + indented items
    const label = (name: string) => parsed.flags.noColor ? name : `\x1b[1m${name}\x1b[0m`;
    const lines: string[] = [];
    lines.push(`${label("ID")}: ${menu.id}`);
    lines.push(`${label("Title")}: ${menu.title}`);
    lines.push(`${label("Handle")}: ${menu.handle}`);
    lines.push(`${label("Items Count")}: ${menu.itemsCount.count}`);
    lines.push("");
    lines.push(`${label("Items")}:`);

    const rows: Array<{ indent: string; title: string; url: string; type: string }> = [];
    flattenItems(menu.items, 0, rows);

    for (const row of rows) {
      lines.push(`${row.indent}${row.title}  (${row.type})  ${row.url}`);
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

const MENUS_LIST_QUERY = `query MenuList {
  menus(first: 250) {
    edges {
      node {
        id
        title
        handle
        itemsCount { count }
        items {
          ${MENU_ITEMS_FRAGMENT}
        }
      }
    }
  }
}`;

async function handleMenuList(parsed: ParsedArgs): Promise<void> {
  try {
    const config = resolveConfig(parsed.flags.store);
    const protocol = process.env.MISTY_PROTOCOL === "http" ? "http" : "https";
    const client = createClient({ ...config, protocol });

    const result = await client.query<{
      menus: { edges: Array<{ node: Menu }> };
    }>(MENUS_LIST_QUERY, {});

    const menus = result.menus.edges.map((e) => e.node);

    if (parsed.flags.json) {
      const data = menus.map((m) => ({
        id: m.id,
        title: m.title,
        handle: m.handle,
        itemCount: m.itemsCount.count,
        items: m.items,
      }));
      formatOutput(data, [], { json: true, noColor: parsed.flags.noColor });
      return;
    }

    // Table output: one section per menu with indented items
    const label = (name: string) =>
      parsed.flags.noColor ? name : `\x1b[1m${name}\x1b[0m`;
    const lines: string[] = [];

    for (let i = 0; i < menus.length; i++) {
      const menu = menus[i]!;
      if (i > 0) lines.push("");
      lines.push(`${label("ID")}: ${menu.id}`);
      lines.push(`${label("Title")}: ${menu.title}`);
      lines.push(`${label("Handle")}: ${menu.handle}`);
      lines.push(`${label("Items Count")}: ${menu.itemsCount.count}`);

      if (menu.items.length > 0) {
        lines.push(`${label("Items")}:`);
        const rows: Array<{ indent: string; title: string; url: string; type: string }> = [];
        flattenItems(menu.items, 0, rows);
        for (const row of rows) {
          lines.push(`  ${row.indent}${row.title}  (${row.type})  ${row.url}`);
        }
      }
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

register("menu", "Navigation menu management", "get", {
  description: "Get a single menu by ID or handle",
  handler: handleMenuGet,
});

register("menu", "Navigation menu management", "list", {
  description: "List all navigation menus",
  handler: handleMenuList,
});
