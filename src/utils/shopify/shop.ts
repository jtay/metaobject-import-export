import { ShopifyGraphQLClient } from '@utils/shopify/client';

export type ShopInfo = {
	name?: string;
	myshopifyDomain?: string;
	email?: string;
	planName?: string;
	primaryDomainHost?: string;
};

const Q_SHOP_INFO = `query ShopInfo {
  shop {
    name
    myshopifyDomain
    email
    plan { displayName }
    primaryDomain { host url }
  }
}`;

export async function getShopInfo(client: ShopifyGraphQLClient): Promise<ShopInfo> {
	try {
		const res = await client.request<{ shop?: { name?: string; myshopifyDomain?: string; email?: string; plan?: { displayName?: string } | null; primaryDomain?: { host?: string; url?: string } | null } }>(Q_SHOP_INFO);
		const s = res.data?.shop ?? {};
		return {
			name: s.name,
			myshopifyDomain: s.myshopifyDomain,
			email: s.email,
			planName: s.plan?.displayName,
			primaryDomainHost: s.primaryDomain?.host
		};
	} catch {
		return {};
	}
} 