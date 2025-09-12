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
        }
        references(first: 25) {
          nodes {
            __typename
            ... on Metaobject { id handle type }
            ... on Product { id handle }
            ... on Page { id handle }
            ... on ProductVariant { id sku product { handle } }
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