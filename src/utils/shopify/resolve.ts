import { ShopifyGraphQLClient } from '@utils/shopify/client';

const Q_METAOBJECT_ID = `query MetaobjectIdByHandle($type: String!, $handle: String!) { metaobjectByHandle(handle: { type: $type, handle: $handle }) { id } }`;
const Q_PRODUCT_ID = `query ProductIdByHandle($handle: String!) { productByHandle(handle: $handle) { id handle } }`;
const Q_PAGE_ID = `query PageIdByHandle($q: String!) { pages(first: 1, query: $q) { nodes { id handle } } }`;
const Q_VARIANTS_FOR_PRODUCT = `query VariantIdByProductHandle($handle: String!) { productByHandle(handle: $handle) { id variants(first: 250) { nodes { id sku } } } }`;
const Q_COLLECTION_ID = `query CollectionIdByHandle($handle: String!) { collectionByHandle(handle: $handle) { id handle } }`;

export type HandleRef = string; // handle://shopify/...

type Cache = Map<string, string | null>;

export class HandleResolver {
	private client: ShopifyGraphQLClient;
	private cache: Cache = new Map();

	constructor(client: ShopifyGraphQLClient) {
		this.client = client;
	}

	async resolve(ref: HandleRef): Promise<string | null> {
		if (this.cache.has(ref)) return this.cache.get(ref)!;
		const id = await this.resolveUncached(ref);
		this.cache.set(ref, id);
		return id;
	}

	private async resolveUncached(ref: HandleRef): Promise<string | null> {
		if (!ref.startsWith('handle://shopify/')) return null;
		const parts = ref.replace('handle://shopify/', '').split('/');
		const kind = parts[0];
		if (kind === 'Metaobject') {
			const type = parts[1];
			const handle = parts.slice(2).join('/');
			const res = await this.client.request<{ metaobjectByHandle: { id: string } | null }>(Q_METAOBJECT_ID, { type, handle });
			return res.data?.metaobjectByHandle?.id ?? null;
		}
		if (kind === 'Product') {
			const handle = parts.slice(1).join('/');
			const res = await this.client.request<{ productByHandle: { id: string } | null }>(Q_PRODUCT_ID, { handle });
			return res.data?.productByHandle?.id ?? null;
		}
		if (kind === 'Page') {
			const handle = parts.slice(1).join('/');
			const q = `handle:${handle}`;
			const res = await this.client.request<{ pages: { nodes: Array<{ id: string; handle: string }> } }>(Q_PAGE_ID, { q });
			return res.data?.pages?.nodes?.[0]?.id ?? null;
		}
		if (kind === 'ProductVariant') {
			const productHandle = parts[1];
			const sku = parts.slice(2).join('/');
			const res = await this.client.request<{ productByHandle: { variants: { nodes: Array<{ id: string; sku?: string | null }> } } | null }>(Q_VARIANTS_FOR_PRODUCT, { handle: productHandle });
			const match = res.data?.productByHandle?.variants?.nodes?.find(v => (v.sku ?? '') === sku);
			return match?.id ?? null;
		}
		if (kind === 'Collection') {
			const handle = parts.slice(1).join('/');
			const res = await this.client.request<{ collectionByHandle: { id: string } | null }>(Q_COLLECTION_ID, { handle });
			return res.data?.collectionByHandle?.id ?? null;
		}
		return null;
	}
} 