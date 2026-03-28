export const API_VERSION = "2026-01";

export interface ClientConfig {
	store: string;
	clientId: string;
	clientSecret: string;
	protocol?: "https" | "http";
	maxRetries?: number;
	timeoutMs?: number;
}

export interface RawGraphQLResponse {
	data?: any;
	errors?: Array<{ message: string; [key: string]: any }>;
	extensions?: any;
}

export interface GraphQLClient {
	query<T = any>(
		query: string,
		variables?: Record<string, unknown>,
	): Promise<T>;
	rawQuery(
		query: string,
		variables?: Record<string, unknown>,
	): Promise<RawGraphQLResponse>;
}

export class GraphQLError extends Error {
	constructor(public errors: Array<{ message: string }>) {
		super(errors.map((e) => e.message).join("; "));
		this.name = "GraphQLError";
	}
}

export class HttpError extends Error {
	constructor(
		public status: number,
		public body: string,
	) {
		super(`HTTP ${status}: ${body}`);
		this.name = "HttpError";
	}
}

export class ConfigError extends Error {
	constructor(public missing: string[]) {
		super(
			`Missing required environment variables: ${missing.join(", ")}\n` +
				`Set them in a .env file or as environment variables.`,
		);
		this.name = "ConfigError";
	}
}

export function resolveConfig(storeFlag?: string): {
	store: string;
	clientId: string;
	clientSecret: string;
} {
	const missing: string[] = [];
	const store = storeFlag || process.env.SHOPIFY_STORE;
	const clientId = process.env.SHOPIFY_CLIENT_ID;
	const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

	if (!store) missing.push("SHOPIFY_STORE");
	if (!clientId) missing.push("SHOPIFY_CLIENT_ID");
	if (!clientSecret) missing.push("SHOPIFY_CLIENT_SECRET");

	if (missing.length > 0) {
		throw new ConfigError(missing);
	}

	return { store: store!, clientId: clientId!, clientSecret: clientSecret! };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TokenResponse {
	accessToken: string;
	scope: string;
	expiresIn: number;
}

export async function exchangeToken(
	opts: Pick<ClientConfig, "store" | "clientId" | "clientSecret" | "protocol">,
): Promise<TokenResponse> {
	const protocol = opts.protocol ?? "https";
	const url = `${protocol}://${opts.store}/admin/oauth/access_token`;

	const body = new URLSearchParams({
		grant_type: "client_credentials",
		client_id: opts.clientId,
		client_secret: opts.clientSecret,
	});

	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new HttpError(response.status, text);
	}

	const json = (await response.json()) as {
		access_token: string;
		scope: string;
		expires_in: number;
	};

	return {
		accessToken: json.access_token,
		scope: json.scope,
		expiresIn: json.expires_in,
	};
}

export function createClient(config: ClientConfig): GraphQLClient {
	const {
		store,
		clientId,
		clientSecret,
		protocol = "https",
		maxRetries = 5,
		timeoutMs = 30000,
	} = config;
	const endpoint = `${protocol}://${store}/admin/api/${API_VERSION}/graphql.json`;

	let cachedToken: string | null = null;
	let tokenExpiresAt = 0;

	async function getAccessToken(): Promise<string> {
		if (cachedToken && Date.now() < tokenExpiresAt) {
			return cachedToken;
		}

		const result = await exchangeToken({
			store,
			clientId,
			clientSecret,
			protocol,
		});
		cachedToken = result.accessToken;
		// Expire 60 seconds early to avoid edge cases
		tokenExpiresAt = Date.now() + result.expiresIn * 1000 - 60000;
		return cachedToken;
	}

	async function fetchRaw(
		query: string,
		variables?: Record<string, unknown>,
	): Promise<RawGraphQLResponse> {
		const accessToken = await getAccessToken();
		const body = JSON.stringify({ query, variables });

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			let response: Response;
			try {
				response = await fetch(endpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-Shopify-Access-Token": accessToken,
					},
					body,
					signal: AbortSignal.timeout(timeoutMs),
				});
			} catch (err: any) {
				if (err?.name === "TimeoutError") {
					throw new Error(`Request timed out after ${timeoutMs}ms`);
				}
				throw err;
			}

			if (response.status === 429) {
				if (attempt === maxRetries) {
					const text = await response.text();
					throw new HttpError(429, text);
				}
				const retryAfter = response.headers.get("Retry-After");
				const waitMs = retryAfter
					? parseFloat(retryAfter) * 1000
					: Math.min(1000 * 2 ** attempt, 30000);
				await sleep(waitMs);
				continue;
			}

			if (!response.ok) {
				const text = await response.text();
				throw new HttpError(response.status, text);
			}

			return (await response.json()) as RawGraphQLResponse;
		}

		throw new Error("Unexpected: exhausted retries");
	}

	return {
		async query<T = any>(
			query: string,
			variables?: Record<string, unknown>,
		): Promise<T> {
			const json = await fetchRaw(query, variables);

			if (json.errors && json.errors.length > 0) {
				throw new GraphQLError(json.errors);
			}

			return json.data as T;
		},

		async rawQuery(
			query: string,
			variables?: Record<string, unknown>,
		): Promise<RawGraphQLResponse> {
			return fetchRaw(query, variables);
		},
	};
}
