import { getClient, handleCommandError } from "../helpers";
import { formatOutput } from "../output";
import { register } from "../registry";
import type { ParsedArgs } from "../types";

const SHOP_QUERY = `{
  shop {
    name
    email
    myshopifyDomain
    plan { displayName }
    currencyCode
    taxesIncluded
    billingAddress {
      address1
      city
      province
      country
      zip
    }
    enabledPresentmentCurrencies
  }
  productsCount { count precision }
}`;

interface ShopResponse {
	shop: {
		name: string;
		email: string;
		myshopifyDomain: string;
		plan: { displayName: string };
		currencyCode: string;
		taxesIncluded: boolean;
		billingAddress: {
			address1: string;
			city: string;
			province: string;
			country: string;
			zip: string;
		} | null;
		enabledPresentmentCurrencies: string[];
	};
	productsCount: { count: number; precision: string };
}

function formatAddress(addr: ShopResponse["shop"]["billingAddress"]): string {
	if (!addr) return "";
	return [addr.address1, addr.city, addr.province, addr.country, addr.zip]
		.filter(Boolean)
		.join(", ");
}

async function handleShopGet(parsed: ParsedArgs): Promise<void> {
	try {
		const client = getClient(parsed.flags);

		const result = await client.query<ShopResponse>(SHOP_QUERY);
		const shop = result.shop;
		const productsCount = result.productsCount;

		if (parsed.flags.json) {
			const data = {
				name: shop.name,
				email: shop.email,
				domain: shop.myshopifyDomain,
				plan: shop.plan.displayName,
				currency: shop.currencyCode,
				taxesIncluded: shop.taxesIncluded,
				billingAddress: shop.billingAddress,
				enabledPresentmentCurrencies: shop.enabledPresentmentCurrencies,
				productsCount,
			};
			formatOutput(data, [], { json: true, noColor: parsed.flags.noColor });
			return;
		}

		// Table output
		const data = {
			name: shop.name,
			email: shop.email,
			domain: shop.myshopifyDomain,
			plan: shop.plan.displayName,
			currency: shop.currencyCode,
			taxesIncluded: String(shop.taxesIncluded),
			billingAddress: formatAddress(shop.billingAddress),
			enabledPresentmentCurrencies:
				shop.enabledPresentmentCurrencies.join(", "),
			productsCount: String(productsCount.count),
		};

		const columns = [
			{ key: "name", header: "Name" },
			{ key: "email", header: "Email" },
			{ key: "domain", header: "Domain" },
			{ key: "plan", header: "Plan" },
			{ key: "currency", header: "Currency" },
			{ key: "taxesIncluded", header: "Taxes Included" },
			{ key: "billingAddress", header: "Billing Address" },
			{ key: "enabledPresentmentCurrencies", header: "Presentment Currencies" },
			{ key: "productsCount", header: "Products Count" },
		];

		formatOutput(data, columns, { json: false, noColor: parsed.flags.noColor });
	} catch (err) {
		handleCommandError(err);
	}
}

register("shop", "Store information", "get", {
	description: "Show store metadata",
	handler: handleShopGet,
});
