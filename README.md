# shopq

[![CI](https://github.com/c-99-e/shopq/actions/workflows/ci.yml/badge.svg)](https://github.com/c-99-e/shopq/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/shopq)](https://www.npmjs.com/package/shopq)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.3-black?logo=bun)](https://bun.sh)

A zero-dependency Shopify Admin CLI built on [Bun](https://bun.sh). Manage products, pages, collections, menus, files, themes, and more from your terminal.

Built with AI agents as the primary user — structured JSON output, predictable exit codes, and no interactive prompts.

## Install

```bash
bun install -g shopq
```

## Prerequisites

- [Bun](https://bun.sh) v1.3+ (also works with Node.js v22+)
- A Shopify store with a [Dev Dashboard app](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials) configured for Client Credentials

## Setup

Configure your store credentials:

```bash
shopq config set --store your-store.myshopify.com --client-id your-client-id --client-secret your-client-secret
```

Or set environment variables:

```
SHOPIFY_STORE=your-store.myshopify.com
SHOPIFY_CLIENT_ID=your-client-id
SHOPIFY_CLIENT_SECRET=your-client-secret
```

### Development

```bash
git clone https://github.com/c-99-e/shopq.git
cd shopq
bun install

# Run locally without affecting a global shopq install
bun run bin/shopq.ts <command>
```

## Usage

```
shopq <resource> <verb> [args] [flags]
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
shopq gql "{ shop { name email } }"

# From a file
shopq gql - < my-query.graphql

# With variables
shopq gql "mutation($id: ID!) { productDelete(input: {id: \$id}) { deletedProductId } }" --variables '{"id": "gid://shopify/Product/123"}'
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
shopq product list --limit 10

# Get a product as JSON
shopq product get "T-Shirt" --json

# Create a product with variants
shopq product create --title "T-Shirt" --variants variants.json

# Get a page by handle
shopq page get --handle "about-us"

# List collections
shopq collection list --json
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
