import { ShopifyGraphQLClient, GraphQLResponse } from '@utils/shopify/client';

const QUERY_METAOBJECTS = `query MetaobjectsPage($type: String!, $first: Int!, $after: String) {
  metaobjects(type: $type, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      handle
      type
      fields {
        key
        type
        value
        jsonValue
        reference {
          __typename
          ... on Metaobject { id handle type }
          ... on Product { id handle }
          ... on Page { id handle }
          ... on ProductVariant { id sku product { handle } }
          ... on Collection { id handle }
        }
        references(first: 25) {
          nodes {
            __typename
            ... on Metaobject { id handle type }
            ... on Product { id handle }
            ... on Page { id handle }
            ... on ProductVariant { id sku product { handle } }
            ... on Collection { id handle }
          }
        }
      }
    }
  }
}`;

const MUTATION_METAOBJECT_UPSERT = `mutation UpsertMetaobject($handle: MetaobjectHandleInput!, $input: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $input) {
    metaobject { id handle type }
    userErrors { field message }
  }
}`;

export type MetaobjectNode = {
	id: string;
	handle: string;
	type: string;
	fields: Array<{
		key: string;
		type: string;
		value?: string | null;
		jsonValue?: unknown;
		reference?: { __typename: string; id: string; handle?: string; type?: string; sku?: string; product?: { handle?: string } } | null;
		references?: { nodes: Array<{ __typename: string; id: string; handle?: string; type?: string; sku?: string; product?: { handle?: string } }> } | null;
	}>;
};

export async function fetchAllMetaobjects(client: ShopifyGraphQLClient, type: string): Promise<MetaobjectNode[]> {
	const first = 250;
	let after: string | undefined = undefined;
	let all: MetaobjectNode[] = [];
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const res: GraphQLResponse<{ metaobjects: { pageInfo: { hasNextPage: boolean; endCursor?: string }; nodes: MetaobjectNode[] } }> = await client.request(QUERY_METAOBJECTS, { type, first, after });
		const page = res.data?.metaobjects;
		if (!page) break;
		all = all.concat(page.nodes);
		if (!page.pageInfo.hasNextPage) break;
		after = page.pageInfo.endCursor ?? undefined;
	}
	return all;
}

export type UpsertMetaobjectInput = {
	handle: { type: string; handle: string };
	metaobject: {
		handle?: string;
		type?: string;
		fields?: Array<{ key: string; value: string }>;
	};
};

export async function upsertMetaobject(client: ShopifyGraphQLClient, input: UpsertMetaobjectInput): Promise<{ id?: string; userErrors?: Array<{ field?: string[]; message: string }> }> {
	const res = await client.request<{ metaobjectUpsert: { metaobject?: { id: string }; userErrors: Array<{ field?: string[]; message: string }> } }>(MUTATION_METAOBJECT_UPSERT, { handle: input.handle, input: input.metaobject });
	return { id: res.data?.metaobjectUpsert.metaobject?.id, userErrors: res.data?.metaobjectUpsert.userErrors };
}

const GID_PREFIX = 'gid://shopify/';
export function isGid(value: unknown): value is string {
	return typeof value === 'string' && value.startsWith(GID_PREFIX);
}

export type ShopifyHandleRef = `handle://shopify/${string}`;

export function toHandleRef(resource: { __typename: string; id: string; handle?: string; type?: string; sku?: string; product?: { handle?: string } }): ShopifyHandleRef | undefined {
	switch (resource.__typename) {
		case 'Metaobject': {
			if (resource.handle && resource.type) return `handle://shopify/Metaobject/${resource.type}/${resource.handle}`;
			return undefined;
		}
		case 'Product': {
			if (resource.handle) return `handle://shopify/Product/${resource.handle}`;
			return undefined;
		}
		case 'Page': {
			if (resource.handle) return `handle://shopify/Page/${resource.handle}`;
			return undefined;
		}
		case 'ProductVariant': {
			const productHandle = resource.product?.handle;
			const sku = resource.sku;
			if (productHandle && sku) return `handle://shopify/ProductVariant/${productHandle}/${sku}`;
			return undefined;
		}
		case 'Collection': {
			if (resource.handle) return `handle://shopify/Collection/${resource.handle}`;
			return undefined;
		}
		default:
			return undefined;
	}
}

export function extractHandleRefsFromFields(fields: MetaobjectNode['fields']): ShopifyHandleRef[] {
	const refs: ShopifyHandleRef[] = [];
	for (const f of fields) {
		if (f.reference) {
			const ref = toHandleRef(f.reference);
			if (ref) refs.push(ref);
		}
		if (f.references?.nodes) {
			for (const n of f.references.nodes) {
				const ref = toHandleRef(n);
				if (ref) refs.push(ref);
			}
		}
	}
	return Array.from(new Set(refs));
}

// Fetch referencedBy for a metaobject id, filtering supported owner types and paginating fully
const QUERY_METAOBJECT_REFERENCED_BY = `query MetaobjectReferencedBy($id: ID!, $first: Int!, $after: String) {
  metaobject(id: $id) {
    referencedBy(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          namespace
          key
          referencer {
            __typename
            ... on Product { id handle }
            ... on ProductVariant { id sku product { handle } }
            ... on Page { id handle }
            ... on Collection { id handle }
          }
        }
      }
    }
  }
}`;

export type BackRefEdge = { node: { namespace: string; key: string; referencer: { __typename: string; id: string; handle?: string; sku?: string; product?: { handle?: string } } } };

export type BackReference = { ownerType: 'Product' | 'ProductVariant' | 'Collection' | 'Page'; owner: string; namespace: string; key: string };

export async function fetchBackReferences(client: ShopifyGraphQLClient, id: string): Promise<BackReference[]> {
	const first = 250;
	let after: string | undefined = undefined;
	const results: BackReference[] = [];
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const res: GraphQLResponse<{ metaobject: { referencedBy: { pageInfo: { hasNextPage: boolean; endCursor?: string }; edges: BackRefEdge[] } } | null }> = await client.request(QUERY_METAOBJECT_REFERENCED_BY, { id, first, after });
		const rb = res.data?.metaobject?.referencedBy as { pageInfo: { hasNextPage: boolean; endCursor?: string }; edges: BackRefEdge[] } | undefined;
		if (!rb) break;
		for (const e of rb.edges) {
			const r = e.node.referencer;
			if (!r) continue;
			if (r.__typename === 'Product' || r.__typename === 'ProductVariant' || r.__typename === 'Collection' || r.__typename === 'Page') {
				let owner: string | undefined;
				if (r.__typename === 'Product' || r.__typename === 'Page' || r.__typename === 'Collection' || r.__typename === 'ProductVariant') {
					const ref = toHandleRef({ __typename: r.__typename, id: r.id, handle: (r as any).handle, sku: (r as any).sku, product: (r as any).product });
					owner = ref ?? r.id;
				}
				if (owner) results.push({ ownerType: r.__typename as any, owner, namespace: e.node.namespace, key: e.node.key });
			}
		}
		if (!rb.pageInfo.hasNextPage) break;
		after = rb.pageInfo.endCursor ?? undefined;
	}
	return results;
} 