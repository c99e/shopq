import { existsSync } from "fs";

/**
 * Update or insert a key=value pair in a .env file.
 * Creates the file if it doesn't exist. Preserves comments and other variables.
 */
export async function upsertEnvVar(envPath: string, key: string, value: string): Promise<void> {
  const line = `${key}="${value}"`;

  if (!existsSync(envPath)) {
    await Bun.write(envPath, line + "\n");
    return;
  }

  const content = await Bun.file(envPath).text();
  const lines = content.split("\n");
  const pattern = new RegExp(`^${key}=`);
  let replaced = false;

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      lines[i] = line;
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    if (lines[lines.length - 1] === "") {
      lines.splice(lines.length - 1, 0, line);
    } else {
      lines.push(line);
    }
  }

  await Bun.write(envPath, lines.join("\n"));
}

/**
 * Validate that the returned state matches the expected state.
 */
export function validateState(expected: string, actual: string): void {
  if (expected !== actual) {
    throw new Error("OAuth state mismatch — possible CSRF attack");
  }
}

/**
 * Exchange an authorization code for an access token.
 */
export async function exchangeToken(opts: {
  store: string;
  clientId: string;
  clientSecret: string;
  code: string;
  oauthBaseUrl?: string;
}): Promise<string> {
  const base = opts.oauthBaseUrl || `https://${opts.store}`;
  const url = `${base}/admin/oauth/access_token`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token exchange failed (HTTP ${response.status}): ${body}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Token exchange response missing access_token");
  }

  return data.access_token;
}

export interface OAuthFlowOptions {
  clientId: string;
  clientSecret: string;
  store: string;
  envPath: string;
  oauthBaseUrl?: string;
  onAuthorizeUrl?: (url: string) => void;
  /** For testing: inject the auth code directly instead of waiting for callback */
  injectCode?: string;
}

/**
 * Build the Shopify authorize URL for the given parameters.
 */
export function buildAuthorizeUrl(store: string, clientId: string, redirectUri: string, state: string): string {
  const scopes = "read_products,write_products,read_content,write_content,read_themes,read_files,write_files,read_orders";
  return (
    `https://${store}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`
  );
}

/**
 * Run the full OAuth authorization code grant flow.
 */
export async function runOAuthFlow(opts: OAuthFlowOptions): Promise<void> {
  const { clientId, clientSecret, store, envPath, oauthBaseUrl } = opts;

  const state = crypto.randomUUID();

  if (opts.injectCode) {
    const token = await exchangeToken({
      store,
      clientId,
      clientSecret,
      code: opts.injectCode,
      oauthBaseUrl,
    });
    await upsertEnvVar(envPath, "MISTY_ACCESS_TOKEN", token);
    return;
  }

  // Start callback server and wait for the OAuth callback
  await new Promise<void>((resolve, reject) => {
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/callback") {
          return new Response("Not found", { status: 404 });
        }

        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");

        if (!code || !returnedState) {
          server.stop(true);
          reject(new Error("Missing code or state parameter in callback"));
          return new Response("Missing code or state parameter", { status: 400 });
        }

        try {
          validateState(state, returnedState);
        } catch (err) {
          server.stop(true);
          reject(err);
          return new Response("State mismatch — authorization denied.", { status: 403 });
        }

        try {
          const token = await exchangeToken({
            store,
            clientId,
            clientSecret,
            code,
            oauthBaseUrl,
          });
          await upsertEnvVar(envPath, "MISTY_ACCESS_TOKEN", token);
          server.stop(true);
          resolve();
          return new Response(
            "<html><body><h1>Login successful!</h1><p>You can close this tab.</p></body></html>",
            { headers: { "Content-Type": "text/html" } },
          );
        } catch (err: any) {
          server.stop(true);
          reject(err);
          return new Response(`Token exchange failed: ${err.message}`, { status: 500 });
        }
      },
    });

    const callbackUrl = `http://localhost:${server.port}/callback`;
    const authorizeUrl = buildAuthorizeUrl(store, clientId, callbackUrl, state);

    opts.onAuthorizeUrl?.(authorizeUrl);

    // Try to open browser
    try {
      Bun.spawn(["open", authorizeUrl], { stdout: "ignore", stderr: "ignore" });
    } catch {
      // Browser open failed — URL is printed below
    }

    process.stderr.write(`\nOpen this URL to authorize:\n${authorizeUrl}\n\nWaiting for callback...\n`);
  });
}
