import { ShopifyGraphQLClient } from '@utils/shopify/client';

export function createShopifyClientFromEnv(): ShopifyGraphQLClient {
	const domain = process.env.SHOPIFY_STORE_DOMAIN;
	const token = process.env.SHOPIFY_ADMIN_API_TOKEN ?? process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
	if (!domain) throw new Error('Missing SHOPIFY_STORE_DOMAIN in environment');
	if (!token) throw new Error('Missing SHOPIFY_ADMIN_API_TOKEN in environment');
	return new ShopifyGraphQLClient({ domain, token, apiVersion: '2025-07' });
} 