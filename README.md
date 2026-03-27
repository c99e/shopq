# shopctl

[![CI](https://github.com/c-99-e/shopify-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/c-99-e/shopify-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.3-black?logo=bun)](https://bun.sh)

A zero-dependency Shopify Admin CLI built on [Bun](https://bun.sh). Manage products, pages, collections, menus, files, themes, and more from your terminal.

Built with AI agents as the primary user — structured JSON output, predictable exit codes, and no interactive prompts.

## Prerequisites

- [Bun](https://bun.sh) v1.3+
- A Shopify store with a [Dev Dashboard app](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials) configured for Client Credentials

## Setup

1. Clone the repo and install dependencies:

```bash
git clone https://github.com/c-99-e/shopify-cli.git
cd shopify-cli
bun install
```

2. Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

```
SHOPIFY_STORE=your-store.myshopify.com
SHOPIFY_CLIENT_ID=your-client-id
SHOPIFY_CLIENT_SECRET=your-client-secret
```

Bun loads `.env` automatically — no extra setup needed.

3. Link the CLI globally (optional):

```bash
bun link
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

## Raw GraphQL

Every resource command is built on Shopify's Admin GraphQL API. When you need something the resource commands don't cover, `gql` gives you direct access:

```bash
# Inline query
shopctl gql "{ shop { name email } }"

# From a file
shopctl gql - < my-query.graphql

# With variables
shopctl gql "mutation($id: ID!) { productDelete(input: {id: \$id}) { deletedProductId } }" --variables '{"id": "gid://shopify/Product/123"}'
```

This is the escape hatch — anything the Shopify Admin API supports, `gql` can do.

## Commands

### Store

| Command | Description |
|---------|-------------|
| `shop get` | Show store metadata |
| `config show` | Show current configuration |

### Products

| Command | Description |
|---------|-------------|
| `product list` | List products with filtering and pagination |
| `product get` | Get a single product by ID or title |
| `product create` | Create a product with optional variant support |
| `product update` | Update a product by ID or title |
| `product delete` | Delete a product by ID or title |

### Content

| Command | Description |
|---------|-------------|
| `page list` | List static store pages |
| `page get` | Get a single page by handle |
| `page create` | Create a static store page |
| `page update` | Update a static store page |
| `page delete` | Delete a static store page |

### Storefront

| Command | Description |
|---------|-------------|
| `collection list` | List collections with pagination |
| `collection get` | Get a single collection by ID or handle |
| `menu list` | List all navigation menus |
| `menu get` | Get a single menu by ID or handle |

### Assets

| Command | Description |
|---------|-------------|
| `file list` | List store files with filtering and pagination |
| `theme list` | List all themes |

## Examples

```bash
# List products
shopctl product list --limit 10

# Get a product as JSON
shopctl product get "T-Shirt" --json

# Create a product with variants
shopctl product create --title "T-Shirt" --variants variants.json

# Get a page by handle
shopctl page get --handle "about-us"

# List collections
shopctl collection list --json
```

## Testing

```bash
bun test
```

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md) code of conduct.

## License

[MIT](LICENSE)
