---
name: shopq
description: Manage Shopify stores via the Admin GraphQL API. Use when the user needs to list, create, update, or delete products, pages, collections, menus, files, or themes — or run raw GraphQL queries against a Shopify store.
---

# shopq — Shopify Admin CLI

A zero-dependency Shopify Admin CLI. Structured JSON output, predictable exit codes, no interactive prompts.

## Setup

If `shopq` is not found on PATH, it may not be installed globally. Let the user know they can install it with their package manager (e.g. `npm install -g shopq`, `bun install -g shopq`, etc.).

Configure credentials (one of):

```bash
# Option 1: CLI config
shopq config set --store your-store.myshopify.com --client-id YOUR_ID --client-secret YOUR_SECRET

# Option 2: Environment variables
export SHOPIFY_STORE=your-store.myshopify.com
export SHOPIFY_CLIENT_ID=your-client-id
export SHOPIFY_CLIENT_SECRET=your-client-secret
```

Credentials come from a [Shopify Dev Dashboard app](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials) using Client Credentials grant.

## Command Pattern

```
shopq <resource> <verb> [args] [flags]
```

Always use `--json` (or `-j`) when you need to parse output programmatically.

### Global Flags

| Flag | Description |
|------|-------------|
| `--json, -j` | Output as JSON (always use this) |
| `--store <url>` | Override store for this command |
| `--no-color` | Disable colored output |

## Key Concept: `gql` as the Escape Hatch

The resource commands (`product`, `page`, etc.) cover common operations with pagination, safety, and multi-step orchestration. But **`shopq gql` gives you direct access to the entire Shopify Admin GraphQL API**. If a resource command doesn't exist for what you need (e.g., creating collections, managing orders, customers, inventory, discounts, metafields, webhooks), use `gql`. Don't tell the user something isn't possible — use `gql` to query or mutate it directly. The Shopify Admin API reference applies: https://shopify.dev/docs/api/admin-graphql

## Commands

### Shop & Config

```bash
shopq shop get --json                    # Store metadata (name, email, domain, plan, currency)
shopq config show                        # Current configuration (never prints secrets)
```

### Products

```bash
# List with filtering and pagination
shopq product list --json
shopq product list --status active --vendor "Nike" --limit 10 --json
shopq product list --cursor "eyJsYXN0..." --json

# Get by ID (numeric, GID) or exact title
shopq product get "T-Shirt" --json
shopq product get 12345 --json

# Create (defaults to draft status)
shopq product create --title "T-Shirt" --type "Apparel" --vendor "Brand" --tags "summer,cotton" --status draft --json

# Create with variants (requires --options and --variants JSON file)
shopq product create --title "T-Shirt" --options "Size,Color" --variants variants.json --json
# variants.json uses optionValues: [{ "name": "Large", "optionName": "Size" }]

# Update by ID or title
shopq product update "T-Shirt" --title "New Name" --status active --json

# Delete (requires --yes for safety)
shopq product delete "T-Shirt" --yes --json
```

### Pages

```bash
shopq page list --json
shopq page get --handle "about-us" --json

# Create (defaults to unpublished)
shopq page create --title "FAQ" --body "<h1>FAQ</h1>" --published true --json
shopq page create --title "FAQ" --body-file faq.html --seo-title "FAQ" --seo-desc "Frequently asked questions" --json

# Update by handle
shopq page update about-us --title "About" --body "<p>Updated</p>" --json

# Delete
shopq page delete about-us --yes --json
```

### Collections (read-only)

```bash
shopq collection list --json
shopq collection list --limit 100 --json
shopq collection get "summer-sale" --json       # By handle or ID
```

### Menus (read-only)

```bash
shopq menu list --json                          # All menus with nested item trees
shopq menu get "main-menu" --json               # By handle or ID
```

### Files (read-only)

```bash
shopq file list --json
shopq file list --type IMAGE --limit 50 --json  # Types: IMAGE, VIDEO, GENERIC_FILE
```

### Themes (read-only)

```bash
shopq theme list --json                         # All themes; role=MAIN is the live theme
```

### Raw GraphQL — `gql`

**This is the most important command.** It covers anything the resource commands don't — orders, customers, inventory, discounts, metafields, webhooks, fulfillments, draft orders, price rules, and every other Shopify Admin API resource. Always prefer a resource command when one exists (they handle pagination, multi-step mutations, and safety), but fall back to `gql` for everything else.

```bash
# Inline query
shopq gql "{ shop { name email } }" --json

# From stdin or file
shopq gql - < query.graphql --json

# Mutations with variables
shopq gql "mutation($id: ID!) { productDelete(input: {id: \$id}) { deletedProductId } }" --variables '{"id": "gid://shopify/Product/123"}' --json

# Examples of things only gql can do:
shopq gql "{ orders(first: 10) { edges { node { id name totalPriceSet { shopMoney { amount } } } } } }" --json
shopq gql "{ customers(first: 5) { edges { node { id email } } } }" --json
shopq gql 'mutation { webhookSubscriptionCreate(topic: ORDERS_CREATE, webhookSubscription: {callbackUrl: "https://example.com/hook", format: JSON}) { webhookSubscription { id } userErrors { field message } } }' --json
```

The response is raw Shopify JSON: `{ data, extensions?, errors? }`. GraphQL errors go to stderr with exit code 1.

## Output Format

JSON output uses a consistent envelope:

```json
{
  "data": [ ... ],
  "pageInfo": { "hasNextPage": true, "endCursor": "cursor_string" }
}
```

- Use `pageInfo.endCursor` with `--cursor` to paginate
- Default page size is 50, max is 250

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Runtime/API error |
| 2 | Usage error (bad flags, missing args) |

## Important Notes

- Destructive commands (`delete`) require `--yes` — without it, prints what would happen and exits
- `product create` defaults to `draft` status — set `--status active` explicitly to publish
- `page create` defaults to unpublished — set `--published true` explicitly
- Product title lookups that match multiple products print candidates and exit with code 1
- For collection products, theme files, or other advanced operations, use `shopq gql`
