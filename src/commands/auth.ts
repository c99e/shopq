import { register } from "../registry";
import { formatError } from "../output";
import { runOAuthFlow } from "../oauth";
import { resolve } from "path";
import type { ParsedArgs } from "../types";

async function handleAuthLogin(parsed: ParsedArgs): Promise<void> {
  const clientId = parsed.args[0] || process.env.MISTY_CLIENT_ID;
  const clientSecret = parsed.args[1] || process.env.MISTY_CLIENT_SECRET;
  const store = parsed.flags.store || process.env.MISTY_STORE;

  if (!clientId) {
    formatError("Missing required argument: client_id\nUsage: misty auth login <client_id> <client_secret> --store <store>");
    process.exitCode = 2;
    return;
  }

  if (!clientSecret) {
    formatError("Missing required argument: client_secret\nUsage: misty auth login <client_id> <client_secret> --store <store>");
    process.exitCode = 2;
    return;
  }

  if (!store) {
    formatError("Missing required flag: --store <store>.myshopify.com (or set MISTY_STORE)");
    process.exitCode = 2;
    return;
  }

  const envPath = resolve(process.cwd(), ".env");
  const oauthBaseUrl = process.env.MISTY_OAUTH_BASE_URL;

  try {
    await runOAuthFlow({
      clientId,
      clientSecret,
      store,
      envPath,
      oauthBaseUrl,
      onAuthorizeUrl: () => {},
    });
  } catch (err: any) {
    formatError(err.message);
    process.exitCode = 1;
  }
}

register("auth", "Authentication management", "login", {
  description: "Log in via OAuth (for Dev Dashboard apps)",
  handler: handleAuthLogin,
});
