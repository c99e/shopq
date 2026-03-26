# Mistea

A zero-dependency Shopify Admin CLI built on [Bun](https://bun.sh). Manage products, pages, collections, menus, files, themes, and more from your terminal.

## Prerequisites

- [Bun](https://bun.sh) v1.3+
- A Shopify store with a [Dev Dashboard app](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials) and its Client ID / Client Secret

## Setup

1. Clone the repo and install dependencies:

```bash
bun install
```

2. Set your environment variables (Bun loads `.env` automatically):

```bash
export SHOPCTL_STORE="your-store.myshopify.com"
export SHOPCTL_CLIENT_ID="your-client-id"
export SHOPCTL_CLIENT_SECRET="your-client-secret"
```

Or create a `.env` file:

```
SHOPCTL_STORE=your-store.myshopify.com
SHOPCTL_CLIENT_ID=your-client-id
SHOPCTL_CLIENT_SECRET=your-client-secret
```

## Usage

```
shopctl <resource> <verb> [args] [flags]
```

### Global flags

| Flag | Description |
|------|-------------|
| `--json, -j` | Output as JSON |
| `--help, -h` | Show help |
| `--version, -v` | Print version |
| `--store <url>` | Store override |
| `--no-color` | Disable colored output (also respects `NO_COLOR` env) |

## Command Reference

| Resource | Verb | Description |
|----------|------|-------------|
| `config` | `show` | Show current configuration |
| `gql` | *(default)* | Execute a raw GraphQL query or mutation |
| `shop` | `get` | Show store metadata |
| `product` | `list` | List products with filtering and pagination |
| `product` | `get` | Get a single product by ID or title |
| `product` | `create` | Create a product with optional variant support |
| `product` | `update` | Update a product by ID or title |
| `product` | `delete` | Delete a product by ID or title |
| `page` | `list` | List static store pages |
| `page` | `get` | Get a single page by handle |
| `page` | `create` | Create a static store page |
| `page` | `update` | Update a static store page |
| `collection` | `list` | List collections with pagination |
| `collection` | `get` | Get a single collection by ID or handle |
| `menu` | `list` | List all navigation menus |
| `menu` | `get` | Get a single menu by ID or handle |
| `file` | `list` | List store files with filtering and pagination |
| `theme` | `list` | List all themes |

## Examples

### List products

```bash
shopctl product list --limit 10
```

### Create a product with variants

```bash
shopctl product create --title "T-Shirt" --variants variants.json
```

### Get a page by handle

```bash
shopctl page get --handle "about-us" --json
```

## Testing

Run the test suite:

```bash
bun test
```

## License

Private — not published.
