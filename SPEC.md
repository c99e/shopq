# Misty CLI — Specification

A Shopify store management CLI designed for AI agents. Commands map to Shopify's resource model with CRUD verbs, plus a raw GraphQL escape hatch for everything else.

## Design Principles

1. **Resource-model driven** — CLI nouns come from Shopify's Admin GraphQL API resources. Not opinionated — derived from the API.
2. **Agent-first** — the primary user is an AI agent, not a human. Every piece of store data an agent might need must be queryable. No "just check the Shopify admin."
3. **CRUD scaffold** — each resource gets standard verbs: `list`, `get`, `create`, `update`, `delete`. Not every resource needs every verb. Read-only resources only get `list` and `get`.
4. **Escape hatch** — `misty gql` provides raw GraphQL access for anything not wrapped in a command. The CLI doesn't need to cover every Shopify API surface — just the frequent and complex operations.
5. **Minimal wrapping** — a command earns its place only if it adds value over raw `misty gql`: multi-step orchestration, pagination, safety (confirmation on deletes), or output formatting.
6. **No over-engineering** — don't build commands for hypothetical needs. Add them when there's a real use case.

## Command Structure

```
misty <resource> <verb> [args] [flags]
```

### Global Flags

Every command supports:

| Flag | Description |
|------|-------------|
| `--json` / `-j` | Output as JSON instead of formatted table |
| `--help` / `-h` | Show command usage |
| `--version` / `-v` | Print CLI version and exit |
| `--store` | One-off store override (reads from env by default) |
| `--no-color` | Disable colored output. Also respects `NO_COLOR` env var (see https://no-color.org) |

---

## Foundation

### `misty config show`

Prints current configuration: store name, API version, config file path. Never prints secrets.

**Acceptance criteria:**
- Reads from environment variables
- Shows store domain and API version
- Masks or omits access token
- Exits with error and clear message if required env vars are missing

### `misty gql <query> [--vars '{}']`

Executes a raw GraphQL query or mutation against the active store.

**Acceptance criteria:**
- Accepts inline query string as positional arg
- Accepts `-` to read query from stdin (e.g., `cat query.graphql | misty gql -`)
- Accepts `--vars` as JSON string for query variables
- Accepts `--file` to read query from a `.graphql` file
- Outputs the raw Shopify JSON response (no envelope wrapping — the response shape is Shopify's `{ data, extensions?, errors? }`)
- GraphQL errors printed to stderr with unwrapped `errors` array, exit code 1
- Handles auth automatically using configured credentials

---

## Resources

### Product

The most complex resource. Creating a product with variants requires multiple mutations chained together (create product, create option definition, bulk create variants). This is the primary reason `product create` exists as a command rather than relying on `misty gql`.

#### `misty product list`

List products with filtering and pagination.

| Flag | Description |
|------|-------------|
| `--status` | Filter: `active`, `draft`, `archived` |
| `--type` | Filter by product type |
| `--vendor` | Filter by vendor name |
| `--limit` | Number of results (default: 50, max: 250) |
| `--cursor` | Pagination cursor for next page |

**Output fields:** id, title, status, productType, vendor, variantsCount, totalInventory

**Acceptance criteria:**
- Cursor-based pagination — returns `nextCursor` in JSON output when more results exist
- Default sort by title
- `--json` output includes pagination metadata (cursor, hasNextPage)
- Table output shows a "next page" hint with the cursor value

#### `misty product get <id-or-title>`

Get a single product by ID (numeric or GID) or exact title match.

**Output fields:** id, title, status, productType, vendor, tags, description (truncated in table, full in JSON), variants (sku, price, option values, inventoryQuantity), images (url, alt)

**Acceptance criteria:**
- Accepts numeric ID, full GID, or title string
- Title lookup uses Shopify's query search — if multiple matches, prints the candidate list (id, title, status) to stdout and exits with code 1. No interactive prompts.
- Returns full product detail including variants and images

#### `misty product create`

Create a product with optional variants.

| Flag | Description |
|------|-------------|
| `--title` | Required. Product title |
| `--handle` | URL slug. If omitted, Shopify auto-generates from title |
| `--type` | Product type |
| `--vendor` | Vendor name |
| `--tags` | Comma-separated tags |
| `--description` | Product description (HTML) |
| `--status` | `active`, `draft` (default: `draft`) |
| `--variants` | Path to JSON file matching Shopify's `ProductVariantInput` schema (uses `optionValues` array of `{ name, optionName }`) |
| `--options` | Comma-separated option names (e.g. `"Size,Format"`) — required if `--variants` uses options |

**Acceptance criteria:**
- Single-variant product (no --variants): one mutation, done
- Multi-variant product: chains create product → create option definitions → bulk create variants
- Variants JSON uses `optionValues` (array of `{ name, optionName }`) — the post-2023-10 Shopify format
- Returns created product ID and variant IDs
- Defaults to `draft` status — agent must explicitly set `active`
- **Partial failure rollback:** if product creates but option/variant mutations fail, the CLI deletes the created product via `productDelete`, returns error with details of what failed, and exits with code 1

#### `misty product update <id-or-title>`

Update product fields and/or variant prices.

| Flag | Description |
|------|-------------|
| `--title` | New title |
| `--description` | New description (HTML) |
| `--type` | New product type |
| `--vendor` | New vendor |
| `--tags` | Replace tags (comma-separated) |
| `--status` | `active`, `draft`, `archived` |

**Acceptance criteria:**
- Only sends fields that are provided (no nulling out unspecified fields)
- Title used for lookup is resolved before update (not sent as the "new" title unless `--title` is explicitly passed)
- Returns updated product summary

#### `misty product delete <id-or-title>`

Delete a product.

**Acceptance criteria:**
- Requires `--yes` flag to confirm, otherwise prints what would be deleted and exits
- Returns deleted product title and ID

---

### Page

Static store pages (About Us, FAQ, Shipping Policy, etc.). SEO metadata is stored as metafields.

#### `misty page list`

List all pages.

| Flag | Description |
|------|-------------|
| `--limit` | Number of results (default: 50) |
| `--cursor` | Pagination cursor |

**Output fields:** id, title, handle, published, bodySummary, seo (title, description), createdAt

**Acceptance criteria:**
- SEO fields extracted from metafields (namespace: `global`, keys: `title_tag`, `description_tag`)
- Cursor-based pagination

#### `misty page get <handle>`

Get a single page by handle.

**Output fields:** id, title, handle, published, body (full HTML), seo (title, description), createdAt, updatedAt

**Acceptance criteria:**
- Returns full body HTML (not truncated)
- Looks up by handle (the URL slug)

#### `misty page create`

| Flag | Description |
|------|-------------|
| `--title` | Required. Page title |
| `--handle` | URL slug. If omitted, Shopify auto-generates from title |
| `--body` | Inline HTML body |
| `--body-file` | Path to HTML file (alternative to --body) |
| `--published` | Boolean (default: false) |
| `--seo-title` | SEO title (stored as metafield) |
| `--seo-desc` | SEO description (stored as metafield) |

**Acceptance criteria:**
- Accepts body as inline string or from file
- Defaults to unpublished — agent must explicitly set `--published true` to go live (matches `product create` safety default)
- SEO fields saved as metafields (namespace: `global`, type: `single_line_text_field`)
- Returns created page handle and ID

#### `misty page update <handle>`

| Flag | Description |
|------|-------------|
| `--title` | New title |
| `--body` | Inline HTML body |
| `--body-file` | Path to HTML file |
| `--seo-title` | SEO title (stored as metafield) |
| `--seo-desc` | SEO description (stored as metafield) |

**Acceptance criteria:**
- At least one field must be provided
- SEO fields saved as metafields (namespace: `global`, type: `single_line_text_field`)
- Returns list of updated field names as a JSON array (e.g., `["title", "seo_title"]`)

---

### Collection

Read-only in v1. Agents need to see what collections exist and their product counts.

#### `misty collection list`

| Flag | Description |
|------|-------------|
| `--limit` | Number of results (default: 50, max: 250) |
| `--cursor` | Pagination cursor |

**Output fields:** id, title, handle, productsCount, description, image (url, alt), seo (title, description)

**Acceptance criteria:**
- Cursor-based pagination
- `productsCount` returns `{ count, precision }` from the API — display `count` in table, full object in JSON
- Note: `hasImage` is not an API field — use presence/absence of `image` instead

#### `misty collection get <id-or-handle>`

**Output fields:** id, title, handle, productsCount, description, image (url, alt), seo (title, description)

**Acceptance criteria:**
- Accepts numeric ID, full GID, or handle
- Returns collection metadata only (no embedded product list — use `misty gql` for collection products)

---

### Theme

Read-only. Actual theme file operations use Shopify CLI directly (`shopify theme pull/push`).

Note: Shopify's GraphQL API does not have a `theme(id:)` query. `theme get` is implemented as a filtered `themes` list query.

#### `misty theme list`

**Output fields:** id, numericId, name, role (MAIN = live), createdAt, updatedAt

**Acceptance criteria:**
- Returns all themes for the store
- `role` field indicates which theme is live (`MAIN`)
- `--json` output follows standard envelope
- No `theme get` command — single theme lookup doesn't justify wrapping over `misty gql`

---

### Menu

Read-only in v1. Navigation structure.

#### `misty menu list`

**Output fields:** id, title, handle, itemCount, items (nested tree: title, url, type)

**Acceptance criteria:**
- Outputs full item hierarchy as returned by the API (no depth cap — Shopify's menu query requires fixed-depth fragments, so implementation uses sufficient depth to cover real menus)
- JSON output preserves full nested tree structure
- Table output flattens with indentation to show hierarchy

#### `misty menu get <id-or-handle>`

Same as list but for a single menu with full item tree.

**Acceptance criteria:**
- Accepts numeric ID, full GID, or handle
- Returns single menu with complete item hierarchy

---

### File

Read-only in v1. Store file library (images, videos, documents).

#### `misty file list`

| Flag | Description |
|------|-------------|
| `--type` | Filter: `IMAGE`, `VIDEO`, `GENERIC_FILE` |
| `--limit` | Number of results (default: 50, max: 250) |
| `--cursor` | Pagination cursor |

**Output fields:** id, filename, url, alt, mediaType, fileSize, createdAt

**Acceptance criteria:**
- Cursor-based pagination
- `--type` values match Shopify's `MediaContentType` enum exactly
- `--json` output follows standard envelope
- No `file get` command — single file lookup doesn't justify wrapping over `misty gql`

---

### Shop

Single resource — no list, just get.

#### `misty shop get`

**Output fields:** name, email, domain, plan, currency, taxesIncluded, billingAddress, enabledPresentmentCurrencies, productsCount

**Acceptance criteria:**
- `productsCount` returns `{ count, precision }` from the API — display `count` in table, full object in JSON
- `enabledPresentmentCurrencies` (not `enabledCurrencies`) — array of currency codes
- Note: `shipsToCountries` removed — not a direct GraphQL field on `Shop` (accessible via shipping queries if needed later)

---

## Shared Behaviors

### Authentication

- Reads from environment variables: `MISTY_STORE`, `MISTY_CLIENT_ID`, `MISTY_CLIENT_SECRET`
- `MISTY_STORE`: the `mystore.myshopify.com` domain (e.g., `my-shop.myshopify.com`)
- `MISTY_CLIENT_ID`: Client ID from a Dev Dashboard app
- `MISTY_CLIENT_SECRET`: Client Secret from a Dev Dashboard app
- Uses the Client Credentials Grant to exchange credentials for a short-lived access token (24h TTL)
- Token is cached in-memory and auto-refreshed when expired
- The exchanged token is passed via the `X-Shopify-Access-Token` header on every request
- `--store` flag overrides `MISTY_STORE` for one-off commands against a different store
- If env vars are missing, print exactly which ones and exit

**Setup steps (for documentation):**
1. Create an app in the [Dev Dashboard](https://shopify.dev/docs/apps/build/dev-dashboard/create-apps-using-dev-dashboard)
2. Configure Admin API scopes (e.g., `read_products`, `write_products`, `read_content`, `write_content`)
3. Release an app version and install on your store
4. Copy Client ID and Client Secret from app settings
5. Set `MISTY_STORE`, `MISTY_CLIENT_ID`, and `MISTY_CLIENT_SECRET` in `.env`

### Pagination

- All list commands use Shopify's cursor-based pagination
- `--limit` controls page size (default: 50, max: 250 — Shopify's API ceiling)
- `--cursor` accepts a cursor string from a previous response
- JSON output always includes: `{ data: [...], pageInfo: { hasNextPage, endCursor } }`
- Table output shows a hint: `"More results available. Use --cursor <value> to see next page."`

### Output

- Default: formatted table for humans / quick reading
- `--json`: structured JSON for agent consumption
- JSON output follows a consistent envelope: `{ data: ..., pageInfo?: ... }`
- Errors output to stderr, data to stdout
- Exit code 0 on success, 1 on runtime/API error, 2 on usage error (bad flags, missing args)

### GraphQL Client

- Centralized client used by all commands
- Exchanges `MISTY_CLIENT_ID`/`MISTY_CLIENT_SECRET` for access token via Client Credentials Grant, then passes it via `X-Shopify-Access-Token` header
- Endpoint: `https://{store}/admin/api/{version}/graphql.json`
- API version pinned in one place (currently `2026-01`)
- Parameterized queries only — no string interpolation of user input into query strings
- Retry on rate limit (HTTP 429) with backoff
- Clear error messages that surface Shopify's error details

### Safety

- Destructive commands (`delete`) require `--yes` flag
- Without `--yes`, print what would happen and exit without acting

---

## Environment

- Runtime: Bun
- No external dependencies beyond Bun built-ins
- Config: `.env` file with `MISTY_STORE`, `MISTY_CLIENT_ID`, `MISTY_CLIENT_SECRET`
- Entry point: `bin/misty.ts`
- Installable as global command via `bun link`

---

## Out of Scope (v1)

- Multi-store profiles (use `--store` flag or swap `.env`)
- Image/media uploads (use `misty gql` for staging mutations)
- Navigation create/update (use `misty gql`)
- Collection create/update/delete (use `misty gql`)
- Order management
- Customer management
- Inventory management
- Discount/pricing rules
- Webhooks
- Theme file sync (use Shopify CLI directly)

---

## Adding Commands Later

A new resource command should:
1. Map to a Shopify Admin API resource
2. Follow the `misty <resource> <verb>` pattern
3. Use the shared GraphQL client
4. Support `--json` and `--help`
5. Use cursor-based pagination for list commands
6. Only exist if it adds value over `misty gql` (multi-step orchestration, pagination, safety, or frequent use)
