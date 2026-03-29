import { getClient, handleCommandError, rejectHandleFlag } from "../helpers";
import { formatError, formatOutput } from "../output";
import { register } from "../registry";
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
    items {
      ${MENU_ITEMS_FRAGMENT}
    }
  }
}`;

const MENU_BY_HANDLE_QUERY = `query MenuGetByHandle($query: String!) {
  menus(first: 1, query: $query) {
    edges {
      node {
        id
        title
        handle
        items {
          ${MENU_ITEMS_FRAGMENT}
        }
      }
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
	items: MenuItem[];
}

function resolveMenuId(
	input: string,
): { type: "gid"; id: string } | { type: "handle"; handle: string } {
	if (input.startsWith("gid://")) {
		return { type: "gid", id: input };
	}
	if (/^\d+$/.test(input)) {
		return { type: "gid", id: `gid://shopify/Menu/${input}` };
	}
	return { type: "handle", handle: input };
}

function flattenItems(
	items: MenuItem[],
	depth: number,
	rows: Array<{ indent: string; title: string; url: string; type: string }>,
) {
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
	if (rejectHandleFlag(parsed, "shopq menu get <id-or-handle>")) return;
	const idOrHandle = parsed.args.join(" ");
	if (!idOrHandle) {
		formatError("Usage: shopq menu get <id-or-handle>");
		process.exitCode = 2;
		return;
	}

	try {
		const client = getClient(parsed.flags);

		const resolved = resolveMenuId(idOrHandle);
		let menu: Menu | null = null;

		if (resolved.type === "gid") {
			const result = await client.query<{ menu: Menu | null }>(
				MENU_BY_ID_QUERY,
				{ id: resolved.id },
			);
			menu = result.menu;
		} else {
			const result = await client.query<{
				menus: { edges: Array<{ node: Menu }> };
			}>(MENU_BY_HANDLE_QUERY, { query: `handle:${resolved.handle}` });
			menu = result.menus.edges[0]?.node ?? null;
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
				itemsCount: menu.items.length,
				items: menu.items,
			};
			formatOutput(data, [], { json: true, noColor: parsed.flags.noColor });
			return;
		}

		// Table output: key-value header + indented items
		const label = (name: string) =>
			parsed.flags.noColor ? name : `\x1b[1m${name}\x1b[0m`;
		const lines: string[] = [];
		lines.push(`${label("ID")}: ${menu.id}`);
		lines.push(`${label("Title")}: ${menu.title}`);
		lines.push(`${label("Handle")}: ${menu.handle}`);
		lines.push(`${label("Items Count")}: ${menu.items.length}`);
		lines.push("");
		lines.push(`${label("Items")}:`);

		const rows: Array<{
			indent: string;
			title: string;
			url: string;
			type: string;
		}> = [];
		flattenItems(menu.items, 0, rows);

		for (const row of rows) {
			lines.push(`${row.indent}${row.title}  (${row.type})  ${row.url}`);
		}

		process.stdout.write(`${lines.join("\n")}\n`);
	} catch (err) {
		handleCommandError(err);
	}
}

const MENUS_LIST_QUERY = `query MenuList {
  menus(first: 250) {
    edges {
      node {
        id
        title
        handle
        items {
          ${MENU_ITEMS_FRAGMENT}
        }
      }
    }
  }
}`;

async function handleMenuList(parsed: ParsedArgs): Promise<void> {
	try {
		const client = getClient(parsed.flags);

		const result = await client.query<{
			menus: { edges: Array<{ node: Menu }> };
		}>(MENUS_LIST_QUERY, {});

		const menus = result.menus.edges.map((e) => e.node);

		if (parsed.flags.json) {
			const data = menus.map((m) => ({
				id: m.id,
				title: m.title,
				handle: m.handle,
				itemCount: m.items.length,
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
			lines.push(`${label("Items Count")}: ${menu.items.length}`);

			if (menu.items.length > 0) {
				lines.push(`${label("Items")}:`);
				const rows: Array<{
					indent: string;
					title: string;
					url: string;
					type: string;
				}> = [];
				flattenItems(menu.items, 0, rows);
				for (const row of rows) {
					lines.push(`  ${row.indent}${row.title}  (${row.type})  ${row.url}`);
				}
			}
		}

		process.stdout.write(`${lines.join("\n")}\n`);
	} catch (err) {
		handleCommandError(err);
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
