export const API_VERSION = "2026-01";

export interface ClientConfig {
  store: string;
  accessToken: string;
  protocol?: "https" | "http";
  maxRetries?: number;
}

export interface GraphQLClient {
  query<T = any>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

export class GraphQLError extends Error {
  constructor(public errors: Array<{ message: string }>) {
    super(errors.map((e) => e.message).join("; "));
    this.name = "GraphQLError";
  }
}

export class HttpError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}: ${body}`);
    this.name = "HttpError";
  }
}

export class ConfigError extends Error {
  constructor(public missing: string[]) {
    super(`Missing required environment variables: ${missing.join(", ")}`);
    this.name = "ConfigError";
  }
}

export function resolveConfig(storeFlag?: string): { store: string; accessToken: string } {
  const missing: string[] = [];
  const store = storeFlag || process.env.MISTY_STORE;
  const accessToken = process.env.MISTY_ACCESS_TOKEN;

  if (!store) missing.push("MISTY_STORE");
  if (!accessToken) missing.push("MISTY_ACCESS_TOKEN");

  if (missing.length > 0) {
    throw new ConfigError(missing);
  }

  return { store: store!, accessToken: accessToken! };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createClient(config: ClientConfig): GraphQLClient {
  const { store, accessToken, protocol = "https", maxRetries = 5 } = config;
  const endpoint = `${protocol}://${store}/admin/api/${API_VERSION}/graphql.json`;

  return {
    async query<T = any>(query: string, variables?: Record<string, unknown>): Promise<T> {
      const body = JSON.stringify({ query, variables });

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": accessToken,
          },
          body,
        });

        if (response.status === 429) {
          if (attempt === maxRetries) {
            const text = await response.text();
            throw new HttpError(429, text);
          }
          const retryAfter = response.headers.get("Retry-After");
          const waitMs = retryAfter ? parseFloat(retryAfter) * 1000 : Math.min(1000 * 2 ** attempt, 30000);
          await sleep(waitMs);
          continue;
        }

        if (!response.ok) {
          const text = await response.text();
          throw new HttpError(response.status, text);
        }

        const json = await response.json() as { data?: T; errors?: Array<{ message: string }> };

        if (json.errors && json.errors.length > 0) {
          throw new GraphQLError(json.errors);
        }

        return json.data as T;
      }

      // Should not reach here
      throw new Error("Unexpected: exhausted retries");
    },
  };
}
