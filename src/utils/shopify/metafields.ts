import { ShopifyGraphQLClient } from '@utils/shopify/client';

const MUTATION_METAFIELDS_SET = `mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id key namespace ownerType value type }
    userErrors { field message }
  }
}`;

export type MetafieldSetItem = {
	ownerId: string;
	namespace: string;
	key: string;
	// Provide either ids (list) or id (single) to control type/shape
	ids?: string[]; // for list.metaobject_reference
	id?: string;    // for metaobject_reference
};

export async function metafieldsSetBatch(client: ShopifyGraphQLClient, items: MetafieldSetItem[]): Promise<{ userErrors: Array<{ field?: string[]; message: string }> }> {
	const inputs = items.map(i => {
		const isList = Array.isArray(i.ids);
		const value = isList ? JSON.stringify(i.ids ?? []) : String(i.id ?? '');
		const type = isList ? 'list.metaobject_reference' : 'metaobject_reference';
		return { ownerId: i.ownerId, namespace: i.namespace, key: i.key, value, type };
	});
	const chunks: typeof inputs[] = [];
	const size = 25; // safe chunk size
	for (let i = 0; i < inputs.length; i += size) chunks.push(inputs.slice(i, i + size));
	const allErrors: Array<{ field?: string[]; message: string }> = [];
	for (const chunk of chunks) {
		const res = await client.request<{ metafieldsSet: { userErrors: Array<{ field?: string[]; message: string }> } }>(MUTATION_METAFIELDS_SET, { metafields: chunk });
		const errs = res.data?.metafieldsSet.userErrors ?? [];
		allErrors.push(...errs);
	}
	return { userErrors: allErrors };
} 