/* eslint-disable no-console */
import { ShopifyGraphQLClient } from '@utils/shopify/client';
import { normaliseMetaobjectType } from '@utils/schema';
import { imageUrlToMediaImageGid } from './imageUrlToMediaImageGid';

const Q_METAOBJECT_ID = `query MetaobjectIdByHandle($type: String!, $handle: String!) { metaobjectByHandle(handle: { type: $type, handle: $handle }) { id } }`;
const Q_PRODUCT_ID = `query ProductIdByHandle($handle: String!) { productByHandle(handle: $handle) { id handle } }`;
const Q_PAGE_ID = `query PageIdByHandle($q: String!) { pages(first: 1, query: $q) { nodes { id handle } } }`;
const Q_VARIANTS_FOR_PRODUCT = `query VariantIdByProductHandle($handle: String!) { productByHandle(handle: $handle) { id variants(first: 250) { nodes { id sku } } } }`;
const Q_COLLECTION_ID = `query CollectionIdByHandle($handle: String!) { collectionByHandle(handle: $handle) { id handle } }`;

// Bulk queries for efficient resolution
const Q_PRODUCTS_BULK = `query ProductsBulk($query: String!) {
  products(first: 250, query: $query) {
    nodes { id handle }
  }
}`;

const Q_COLLECTIONS_BULK = `query CollectionsBulk($query: String!) {
  collections(first: 250, query: $query) {
    nodes { id handle }
  }
}`;

const Q_PAGES_BULK = `query PagesBulk($query: String!) {
  pages(first: 250, query: $query) {
    nodes { id handle }
  }
}`;

// For metaobjects, we need to group by type since the API requires type parameter
const Q_METAOBJECTS_BY_TYPE = `query MetaobjectsByType($type: String!) {
  metaobjects(type: $type, first: 250) {
    nodes { 
      id 
      handle 
      type
    }
  }
}`;

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
			const type = normaliseMetaobjectType(parts[1]);
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
		if (kind === 'MediaImage') {
			const imageUrl = parts.slice(1).join('/');
			const result = await imageUrlToMediaImageGid(this.client, imageUrl);
			return result.id;
		}
		return null;
	}
}

export type BulkResolveProgress = {
	phase: 'collecting' | 'resolving-products' | 'resolving-collections' | 'resolving-pages' | 'resolving-metaobjects' | 'resolving-variants' | 'resolving-media-images' | 'complete';
	total: number;
	processed: number;
	currentType?: string;
	message?: string;
	error?: string;
	apiCallsCount?: number;
	resolvedCount?: number;
	failedCount?: number;
};

export class BulkHandleResolver {
	private client: ShopifyGraphQLClient;
	private cache: Cache = new Map();

	constructor(client: ShopifyGraphQLClient) {
		this.client = client;
	}

	async resolve(ref: HandleRef): Promise<string | null> {
		if (this.cache.has(ref)) return this.cache.get(ref)!;
		// For single resolution, fall back to individual query
		return await this.resolveUncached(ref);
	}

	async resolveBulk(refs: HandleRef[], onProgress?: (progress: BulkResolveProgress) => void): Promise<Map<HandleRef, string | null>> {
		const results = new Map<HandleRef, string | null>();
		const uncachedRefs: HandleRef[] = [];

		// Check cache first
		for (const ref of refs) {
			if (this.cache.has(ref)) {
				results.set(ref, this.cache.get(ref)!);
			} else {
				uncachedRefs.push(ref);
			}
		}

		if (uncachedRefs.length === 0) {
			onProgress?.({ phase: 'complete', total: refs.length, processed: refs.length, message: 'All references cached', resolvedCount: refs.length, failedCount: 0, apiCallsCount: 0 });
			return results;
		}

		onProgress?.({ phase: 'collecting', total: refs.length, processed: refs.length - uncachedRefs.length, message: 'Grouping references by type...' });

		// Group by resource type for bulk resolution
		const byType = this.groupRefsByType(uncachedRefs);
		const totalTypes = (byType.products.length > 0 ? 1 : 0) + 
						  (byType.collections.length > 0 ? 1 : 0) + 
						  (byType.pages.length > 0 ? 1 : 0) + 
						  (byType.metaobjects.size > 0 ? byType.metaobjects.size : 0) + 
						  (byType.productVariants.length > 0 ? 1 : 0) + 
						  (byType.mediaImages.length > 0 ? 1 : 0);
		
		let processedTypes = 0;
		let apiCallsCount = 0;
		let totalResolvedCount = 0;
		let totalFailedCount = 0;

		// Resolve each type in bulk
		if (byType.products.length > 0) {
			onProgress?.({ phase: 'resolving-products', total: totalTypes, processed: processedTypes, currentType: 'Products', message: `Resolving ${byType.products.length} product references...`, apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
			try {
				const { resolved, failed } = await this.resolveProductsBulk(byType.products, results);
				apiCallsCount++;
				// Count resolved vs failed
				totalResolvedCount += resolved;
				totalFailedCount += failed;
				onProgress?.({ phase: 'resolving-products', total: totalTypes, processed: processedTypes, currentType: 'Products', message: `Resolved ${resolved} products, ${failed} failed`, apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
			} catch (error) {
				totalFailedCount += byType.products.length;
				onProgress?.({ phase: 'resolving-products', total: totalTypes, processed: processedTypes, currentType: 'Products', message: `Failed to resolve products`, error: String(error), apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
			}
			processedTypes++;
		}

		if (byType.collections.length > 0) {
			onProgress?.({ phase: 'resolving-collections', total: totalTypes, processed: processedTypes, currentType: 'Collections', message: `Resolving ${byType.collections.length} collection references...`, apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
			try {
				const { resolved, failed } = await this.resolveCollectionsBulk(byType.collections, results);
				apiCallsCount++;
				// Count resolved vs failed
				totalResolvedCount += resolved;
				totalFailedCount += failed;
				onProgress?.({ phase: 'resolving-collections', total: totalTypes, processed: processedTypes, currentType: 'Collections', message: `Resolved ${resolved} collections, ${failed} failed`, apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
			} catch (error) {
				totalFailedCount += byType.collections.length;
				onProgress?.({ phase: 'resolving-collections', total: totalTypes, processed: processedTypes, currentType: 'Collections', message: `Failed to resolve collections`, error: String(error), apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
			}
			processedTypes++;
		}

		if (byType.pages.length > 0) {
			onProgress?.({ phase: 'resolving-pages', total: totalTypes, processed: processedTypes, currentType: 'Pages', message: `Resolving ${byType.pages.length} page references...`, apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
			try {
				const { resolved, failed } = await this.resolvePagesBulk(byType.pages, results);
				apiCallsCount++;
				// Count resolved vs failed
				totalResolvedCount += resolved;
				totalFailedCount += failed;
				onProgress?.({ phase: 'resolving-pages', total: totalTypes, processed: processedTypes, currentType: 'Pages', message: `Resolved ${resolved} pages, ${failed} failed`, apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
			} catch (error) {
				totalFailedCount += byType.pages.length;
				onProgress?.({ phase: 'resolving-pages', total: totalTypes, processed: processedTypes, currentType: 'Pages', message: `Failed to resolve pages`, error: String(error), apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
			}
			processedTypes++;
		}

		if (byType.metaobjects.size > 0) {
			for (const [type, metaobjects] of byType.metaobjects) {
				onProgress?.({ phase: 'resolving-metaobjects', total: totalTypes, processed: processedTypes, currentType: `Metaobjects (${type})`, message: `Resolving ${metaobjects.length} ${type} references...`, apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
				try {
					const { resolved, failed } = await this.resolveMetaobjectsBulk(new Map([[type, metaobjects]]), results);
					apiCallsCount++;
					// Count resolved vs failed
					totalResolvedCount += resolved;
					totalFailedCount += failed;
					onProgress?.({ phase: 'resolving-metaobjects', total: totalTypes, processed: processedTypes, currentType: `Metaobjects (${type})`, message: `Resolved ${resolved} ${type}, ${failed} failed`, apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
				} catch (error) {
					totalFailedCount += metaobjects.length;
					onProgress?.({ phase: 'resolving-metaobjects', total: totalTypes, processed: processedTypes, currentType: `Metaobjects (${type})`, message: `Failed to resolve ${type} metaobjects`, error: String(error), apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
				}
				processedTypes++;
			}
		}

		if (byType.productVariants.length > 0) {
			onProgress?.({ phase: 'resolving-variants', total: totalTypes, processed: processedTypes, currentType: 'Product Variants', message: `Resolving ${byType.productVariants.length} variant references...`, apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
			try {
				const { resolved, failed } = await this.resolveProductVariantsBulk(byType.productVariants, results, (variantProgress) => {
					// Update progress with running totals during variant resolution
					onProgress?.({ 
						phase: 'resolving-variants', 
						total: totalTypes, 
						processed: processedTypes, 
						currentType: 'Product Variants', 
						message: variantProgress.message || `Resolving variants...`,
						apiCallsCount: apiCallsCount + variantProgress.apiCalls,
						resolvedCount: totalResolvedCount + variantProgress.resolved,
						failedCount: totalFailedCount + variantProgress.failed
					});
				});
				// Count API calls (one per unique product)
				const uniqueProducts = new Set(byType.productVariants.map(v => v.productHandle));
				apiCallsCount += uniqueProducts.size;
				// Count resolved vs failed
				totalResolvedCount += resolved;
				totalFailedCount += failed;
				onProgress?.({ phase: 'resolving-variants', total: totalTypes, processed: processedTypes, currentType: 'Product Variants', message: `Resolved ${resolved} variants, ${failed} failed`, apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
			} catch (error) {
				totalFailedCount += byType.productVariants.length;
				onProgress?.({ phase: 'resolving-variants', total: totalTypes, processed: processedTypes, currentType: 'Product Variants', message: `Failed to resolve variants`, error: String(error), apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
			}
			processedTypes++;
		}

		if (byType.mediaImages.length > 0) {
			onProgress?.({ phase: 'resolving-media-images', total: totalTypes, processed: processedTypes, currentType: 'Media Images', message: `Resolving ${byType.mediaImages.length} media image references...`, apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
			try {
				const { resolved, failed } = await this.resolveMediaImagesBulk(byType.mediaImages, results);
				apiCallsCount++;
				// Count resolved vs failed
				totalResolvedCount += resolved;
				totalFailedCount += failed;
				onProgress?.({ phase: 'resolving-media-images', total: totalTypes, processed: processedTypes, currentType: 'Media Images', message: `Resolved ${resolved} media images, ${failed} failed`, apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
			} catch (error) {
				totalFailedCount += byType.mediaImages.length;
				onProgress?.({ phase: 'resolving-media-images', total: totalTypes, processed: processedTypes, currentType: 'Media Images', message: `Failed to resolve media images`, error: String(error), apiCallsCount, resolvedCount: totalResolvedCount, failedCount: totalFailedCount });
			}
			processedTypes++;
		}

		// Cache all results
		for (const [ref, id] of results) {
			this.cache.set(ref, id);
		}

		const cachedCount = refs.length - uncachedRefs.length;
		onProgress?.({ 
			phase: 'complete', 
			total: totalTypes, 
			processed: totalTypes, 
			message: `Resolved ${refs.length} references: ${totalResolvedCount} found, ${totalFailedCount} missing, ${cachedCount} cached`,
			apiCallsCount,
			resolvedCount: totalResolvedCount + cachedCount,
			failedCount: totalFailedCount
		});

		return results;
	}

	private groupRefsByType(refs: HandleRef[]) {
		const products: Array<{ ref: HandleRef; handle: string }> = [];
		const collections: Array<{ ref: HandleRef; handle: string }> = [];
		const pages: Array<{ ref: HandleRef; handle: string }> = [];
		const metaobjects: Map<string, Array<{ ref: HandleRef; handle: string }>> = new Map();
		const productVariants: Array<{ ref: HandleRef; productHandle: string; sku: string }> = [];
		const mediaImages: Array<{ ref: HandleRef; imageUrl: string }> = [];

		for (const ref of refs) {
			if (!ref.startsWith('handle://shopify/')) continue;
			const parts = ref.replace('handle://shopify/', '').split('/');
			const kind = parts[0];

			switch (kind) {
				case 'Product':
					products.push({ ref, handle: parts.slice(1).join('/') });
					break;
				case 'Collection':
					collections.push({ ref, handle: parts.slice(1).join('/') });
					break;
				case 'Page':
					pages.push({ ref, handle: parts.slice(1).join('/') });
					break;
				case 'Metaobject': {
					const type = normaliseMetaobjectType(parts[1]);
					const handle = parts.slice(2).join('/');
					if (!metaobjects.has(type)) metaobjects.set(type, []);
					metaobjects.get(type)!.push({ ref, handle });
					break;
				}
				case 'ProductVariant': {
					const productHandle = parts[1];
					const sku = parts.slice(2).join('/');
					productVariants.push({ ref, productHandle, sku });
					break;
				}
				case 'MediaImage': {
					const imageUrl = parts.slice(1).join('/');
					mediaImages.push({ ref, imageUrl });
					break;
				}
			}
		}

		return { products, collections, pages, metaobjects, productVariants, mediaImages };
	}

	private async resolveProductsBulk(products: Array<{ ref: HandleRef; handle: string }>, results: Map<HandleRef, string | null>): Promise<{ resolved: number; failed: number }> {
		if (products.length === 0) return { resolved: 0, failed: 0 };

		try {
			// Build query string for multiple handles
			const handleQuery = products.map(p => `handle:${p.handle}`).join(' OR ');
			const res = await this.client.request<{ products: { nodes: Array<{ id: string; handle: string }> } }>(
				Q_PRODUCTS_BULK, 
				{ query: handleQuery }
			);

			// Check for GraphQL errors
			if (res.errors && res.errors.length > 0) {
				const errorMsg = res.errors.map(e => e.message).join('; ');
				throw new Error(`GraphQL errors in products bulk resolve: ${errorMsg}`);
			}

			// Validate response structure
			if (!res.data?.products?.nodes) {
				throw new Error(`Invalid response structure for products bulk resolve: ${JSON.stringify(res.data)}`);
			}

			const nodesByHandle = new Map<string, string>();
			for (const node of res.data.products.nodes) {
				if (!node.id || !node.handle) {
					console.warn(`Invalid product node in bulk resolve:`, node);
					continue;
				}
				nodesByHandle.set(node.handle, node.id);
			}

			let resolvedCount = 0;
			let failedCount = 0;
			for (const { ref, handle } of products) {
				const id = nodesByHandle.get(handle) ?? null;
				results.set(ref, id);
				if (id) resolvedCount++;
				else failedCount++;
			}

			console.log(`Products bulk resolve: ${resolvedCount} resolved, ${failedCount} failed out of ${products.length} requested`);
			return { resolved: resolvedCount, failed: failedCount };
		} catch (error) {
			console.error(`Error in products bulk resolve:`, error);
			// Mark all as failed
			for (const { ref } of products) {
				results.set(ref, null);
			}
			throw error;
		}
	}

	private async resolveCollectionsBulk(collections: Array<{ ref: HandleRef; handle: string }>, results: Map<HandleRef, string | null>): Promise<{ resolved: number; failed: number }> {
		if (collections.length === 0) return { resolved: 0, failed: 0 };

		try {
			const handleQuery = collections.map(c => `handle:${c.handle}`).join(' OR ');
			const res = await this.client.request<{ collections: { nodes: Array<{ id: string; handle: string }> } }>(
				Q_COLLECTIONS_BULK, 
				{ query: handleQuery }
			);

			// Check for GraphQL errors
			if (res.errors && res.errors.length > 0) {
				const errorMsg = res.errors.map(e => e.message).join('; ');
				throw new Error(`GraphQL errors in collections bulk resolve: ${errorMsg}`);
			}

			// Validate response structure
			if (!res.data?.collections?.nodes) {
				throw new Error(`Invalid response structure for collections bulk resolve: ${JSON.stringify(res.data)}`);
			}

			const nodesByHandle = new Map<string, string>();
			for (const node of res.data.collections.nodes) {
				if (!node.id || !node.handle) {
					console.warn(`Invalid collection node in bulk resolve:`, node);
					continue;
				}
				nodesByHandle.set(node.handle, node.id);
			}

			let resolvedCount = 0;
			let failedCount = 0;
			for (const { ref, handle } of collections) {
				const id = nodesByHandle.get(handle) ?? null;
				results.set(ref, id);
				if (id) resolvedCount++;
				else failedCount++;
			}

			console.log(`Collections bulk resolve: ${resolvedCount} resolved, ${failedCount} failed out of ${collections.length} requested`);
			return { resolved: resolvedCount, failed: failedCount };
		} catch (error) {
			console.error(`Error in collections bulk resolve:`, error);
			// Mark all as failed
			for (const { ref } of collections) {
				results.set(ref, null);
			}
			throw error;
		}
	}

	private async resolvePagesBulk(pages: Array<{ ref: HandleRef; handle: string }>, results: Map<HandleRef, string | null>): Promise<{ resolved: number; failed: number }> {
		if (pages.length === 0) return { resolved: 0, failed: 0 };

		try {
			const handleQuery = pages.map(p => `handle:${p.handle}`).join(' OR ');
			const res = await this.client.request<{ pages: { nodes: Array<{ id: string; handle: string }> } }>(
				Q_PAGES_BULK, 
				{ query: handleQuery }
			);

			// Check for GraphQL errors
			if (res.errors && res.errors.length > 0) {
				const errorMsg = res.errors.map(e => e.message).join('; ');
				throw new Error(`GraphQL errors in pages bulk resolve: ${errorMsg}`);
			}

			// Validate response structure
			if (!res.data?.pages?.nodes) {
				throw new Error(`Invalid response structure for pages bulk resolve: ${JSON.stringify(res.data)}`);
			}

			const nodesByHandle = new Map<string, string>();
			for (const node of res.data.pages.nodes) {
				if (!node.id || !node.handle) {
					console.warn(`Invalid page node in bulk resolve:`, node);
					continue;
				}
				nodesByHandle.set(node.handle, node.id);
			}

			let resolvedCount = 0;
			let failedCount = 0;
			for (const { ref, handle } of pages) {
				const id = nodesByHandle.get(handle) ?? null;
				results.set(ref, id);
				if (id) resolvedCount++;
				else failedCount++;
			}

			console.log(`Pages bulk resolve: ${resolvedCount} resolved, ${failedCount} failed out of ${pages.length} requested`);
			return { resolved: resolvedCount, failed: failedCount };
		} catch (error) {
			console.error(`Error in pages bulk resolve:`, error);
			// Mark all as failed
			for (const { ref } of pages) {
				results.set(ref, null);
			}
			throw error;
		}
	}

	private async resolveMetaobjectsBulk(metaobjectsByType: Map<string, Array<{ ref: HandleRef; handle: string }>>, results: Map<HandleRef, string | null>): Promise<{ resolved: number; failed: number }> {
		let totalResolvedCount = 0;
		let totalFailedCount = 0;

		for (const [type, metaobjects] of metaobjectsByType) {
			if (metaobjects.length === 0) continue;

			try {
				const res = await this.client.request<{ metaobjects: { nodes: Array<{ id: string; handle: string; type: string }> } }>(
					Q_METAOBJECTS_BY_TYPE, 
					{ type }
				);

				// Check for GraphQL errors
				if (res.errors && res.errors.length > 0) {
					const errorMsg = res.errors.map(e => e.message).join('; ');
					throw new Error(`GraphQL errors in metaobjects bulk resolve for type ${type}: ${errorMsg}`);
				}

				// Validate response structure
				if (!res.data?.metaobjects?.nodes) {
					throw new Error(`Invalid response structure for metaobjects bulk resolve (type: ${type}): ${JSON.stringify(res.data)}`);
				}

				const nodesByHandle = new Map<string, string>();
				for (const node of res.data.metaobjects.nodes) {
					if (!node.id || !node.handle || !node.type) {
						console.warn(`Invalid metaobject node in bulk resolve:`, node);
						continue;
					}
					if (normaliseMetaobjectType(node.type) === type) {
						nodesByHandle.set(node.handle, node.id);
					}
				}

				let resolvedCount = 0;
				let failedCount = 0;
				for (const { ref, handle } of metaobjects) {
					const id = nodesByHandle.get(handle) ?? null;
					results.set(ref, id);
					if (id) resolvedCount++;
					else failedCount++;
				}

				totalResolvedCount += resolvedCount;
				totalFailedCount += failedCount;

				console.log(`Metaobjects bulk resolve (${type}): ${resolvedCount} resolved, ${failedCount} failed out of ${metaobjects.length} requested`);
			} catch (error) {
				console.error(`Error in metaobjects bulk resolve for type ${type}:`, error);
				// Mark all as failed
				for (const { ref } of metaobjects) {
					results.set(ref, null);
					totalFailedCount++;
				}
				throw error;
			}
		}

		return { resolved: totalResolvedCount, failed: totalFailedCount };
	}

	private async resolveProductVariantsBulk(variants: Array<{ ref: HandleRef; productHandle: string; sku: string }>, results: Map<HandleRef, string | null>, onVariantProgress?: (progress: { message?: string; apiCalls: number; resolved: number; failed: number }) => void): Promise<{ resolved: number; failed: number }> {
		if (variants.length === 0) return { resolved: 0, failed: 0 };

		try {
			// Group by product handle to minimize API calls
			const variantsByProduct = new Map<string, Array<{ ref: HandleRef; sku: string }>>();
			for (const variant of variants) {
				if (!variantsByProduct.has(variant.productHandle)) {
					variantsByProduct.set(variant.productHandle, []);
				}
				variantsByProduct.get(variant.productHandle)!.push({ ref: variant.ref, sku: variant.sku });
			}

			let totalResolvedCount = 0;
			let totalFailedCount = 0;
			let apiCallsCount = 0;

			// Resolve each product's variants
			for (const [productHandle, productVariants] of variantsByProduct) {
				try {
					onVariantProgress?.({ 
						message: `Resolving variants for ${productHandle}...`,
						apiCalls: apiCallsCount,
						resolved: totalResolvedCount,
						failed: totalFailedCount
					});

					const res = await this.client.request<{ productByHandle: { variants: { nodes: Array<{ id: string; sku?: string | null }> } } | null }>(
						Q_VARIANTS_FOR_PRODUCT, 
						{ handle: productHandle }
					);

					apiCallsCount++;

					// Check for GraphQL errors
					if (res.errors && res.errors.length > 0) {
						const errorMsg = res.errors.map(e => e.message).join('; ');
						throw new Error(`GraphQL errors in product variants resolve for ${productHandle}: ${errorMsg}`);
					}

					// Check if product exists
					if (!res.data?.productByHandle) {
						console.warn(`Product not found for handle: ${productHandle}`);
						for (const { ref } of productVariants) {
							results.set(ref, null);
							totalFailedCount++;
						}
						onVariantProgress?.({ 
							message: `Product ${productHandle} not found`,
							apiCalls: apiCallsCount,
							resolved: totalResolvedCount,
							failed: totalFailedCount
						});
						continue;
					}

					// Validate response structure
					if (!res.data.productByHandle.variants?.nodes) {
						throw new Error(`Invalid response structure for product variants resolve (${productHandle}): ${JSON.stringify(res.data)}`);
					}

					const variantsBySku = new Map<string, string>();
					for (const variant of res.data.productByHandle.variants.nodes) {
						if (!variant.id) {
							console.warn(`Invalid variant node (missing id):`, variant);
							continue;
						}
						if (variant.sku) {
							variantsBySku.set(variant.sku, variant.id);
						}
					}

					let resolvedCount = 0;
					let failedCount = 0;
					for (const { ref, sku } of productVariants) {
						const id = variantsBySku.get(sku) ?? null;
						results.set(ref, id);
						if (id) resolvedCount++;
						else failedCount++;
					}

					totalResolvedCount += resolvedCount;
					totalFailedCount += failedCount;

					console.log(`Product variants resolve (${productHandle}): ${resolvedCount} resolved, ${failedCount} failed out of ${productVariants.length} requested`);
					
					onVariantProgress?.({ 
						message: `Resolved ${productHandle}: ${resolvedCount} found, ${failedCount} missing`,
						apiCalls: apiCallsCount,
						resolved: totalResolvedCount,
						failed: totalFailedCount
					});
				} catch (error) {
					console.error(`Error resolving variants for product ${productHandle}:`, error);
					// Mark all variants for this product as failed
					for (const { ref } of productVariants) {
						results.set(ref, null);
						totalFailedCount++;
					}
					onVariantProgress?.({ 
						message: `Error resolving ${productHandle}`,
						apiCalls: apiCallsCount,
						resolved: totalResolvedCount,
						failed: totalFailedCount
					});
				}
			}

			console.log(`Total product variants bulk resolve: ${totalResolvedCount} resolved, ${totalFailedCount} failed out of ${variants.length} requested`);
			return { resolved: totalResolvedCount, failed: totalFailedCount };
		} catch (error) {
			console.error(`Error in product variants bulk resolve:`, error);
			// Mark all as failed
			for (const { ref } of variants) {
				results.set(ref, null);
			}
			throw error;
		}
	}

	private async resolveMediaImagesBulk(mediaImages: Array<{ ref: HandleRef; imageUrl: string }>, results: Map<HandleRef, string | null>): Promise<{ resolved: number; failed: number }> {
		if (mediaImages.length === 0) return { resolved: 0, failed: 0 };

		let resolvedCount = 0;
		let failedCount = 0;

		// Process each media image individually since we need to create them via fileCreate
		for (const { ref, imageUrl } of mediaImages) {
			try {
				const result = await imageUrlToMediaImageGid(this.client, imageUrl);
				results.set(ref, result.id);
				if (result.id) {
					resolvedCount++;
				} else {
					failedCount++;
				}
			} catch (error) {
				console.error(`Error resolving media image ${imageUrl}:`, error);
				results.set(ref, null);
				failedCount++;
			}
		}

		console.log(`Media images bulk resolve: ${resolvedCount} resolved, ${failedCount} failed out of ${mediaImages.length} requested`);
		return { resolved: resolvedCount, failed: failedCount };
	}

	private async resolveUncached(ref: HandleRef): Promise<string | null> {
		// Fallback to individual resolution for single refs
		const resolver = new HandleResolver(this.client);
		return resolver.resolve(ref);
	}
} 