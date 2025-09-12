import { ShopifyGraphQLClient } from '@utils/shopify/client';
import { HandleResolver } from '@utils/shopify/resolve';
import type { ExportFile, ExportEntry } from '@utils/schema';
import { upsertMetaobject } from '@utils/shopify/metaobjects';
import { metafieldsSetBatch } from '@utils/shopify/metafields';

export type ImportProgress = {
	index: number;
	total: number;
	current?: ExportEntry;
	message?: string;
	error?: string;
};

export type ImportOptions = {
	onProgress?: (p: ImportProgress) => void;
};

export async function runImport(client: ShopifyGraphQLClient, file: ExportFile, opts: ImportOptions): Promise<void> {
	const resolver = new HandleResolver(client);
	const entries = file.entries;
	const createdIdsByHandleKey = new Map<string, string>(); // key: type/handle -> id
	for (let i = 0; i < entries.length; i += 1) {
		const e = entries[i];
		opts.onProgress?.({ index: i, total: entries.length, current: e, message: `Upserting ${e.type}/${e.handle}` });
		const fields = await transformFieldsForImport(e.fields, resolver);
		const input = {
			handle: { type: e.type, handle: e.handle },
			metaobject: { fields: Object.entries(fields).map(([key, value]) => ({ key, value: serialiseField(value) })) }
		};
		const res = await upsertMetaobject(client, input);
		if (res.userErrors && res.userErrors.length) {
			throw new Error(`Failed to upsert ${e.type}/${e.handle}: ${res.userErrors.map(u => u.message).join('; ')}`);
		}
		if (res.id) createdIdsByHandleKey.set(`${e.type}/${e.handle}`, res.id);
	}

	// Post-pass: apply back references if present
	const pending: Array<{ ownerRef: string; namespace: string; key: string; metaobjectKey: string }> = [];
	for (const e of entries) {
		const brs = e.backReferences ?? [];
		for (const br of brs) {
			pending.push({ ownerRef: br.owner, namespace: br.namespace, key: br.key, metaobjectKey: `${e.type}/${e.handle}` });
		}
	}
	if (pending.length === 0) return;

	opts.onProgress?.({ index: entries.length, total: entries.length, message: `Applying back references…` });

	// Resolve owners and group per owner/namespace/key, aggregate IDs to detect list vs single
	type GroupKey = string; // `${ownerId}:${namespace}:${key}` but owner might be a handle ref initially
	const groups = new Map<GroupKey, { ownerId?: string; ownerRef: string; namespace: string; key: string; metaobjectIds: string[] }>();
	for (const p of pending) {
		const ownerId: string | null = p.ownerRef.startsWith('handle://shopify/') ? await resolver.resolve(p.ownerRef) : (p.ownerRef.startsWith('gid://shopify/') ? p.ownerRef : null);
		if (!ownerId) continue; // skip missing owners
		const metaobjectId = createdIdsByHandleKey.get(p.metaobjectKey);
		if (!metaobjectId) continue; // metaobject not created? skip
		const gk = `${ownerId}:${p.namespace}:${p.key}`;
		if (!groups.has(gk)) groups.set(gk, { ownerId, ownerRef: p.ownerRef, namespace: p.namespace, key: p.key, metaobjectIds: [] });
		groups.get(gk)!.metaobjectIds.push(metaobjectId);
	}

	const items: { ownerId: string; namespace: string; key: string; ids?: string[]; id?: string }[] = [];
	for (const g of groups.values()) {
		const unique = Array.from(new Set(g.metaobjectIds));
		if (unique.length === 0 || !g.ownerId) continue;
		if (unique.length === 1) {
			items.push({ ownerId: g.ownerId, namespace: g.namespace, key: g.key, id: unique[0] });
		} else {
			items.push({ ownerId: g.ownerId, namespace: g.namespace, key: g.key, ids: unique });
		}
	}
	if (items.length === 0) return;

	const res2 = await metafieldsSetBatch(client, items);
	if (res2.userErrors.length) {
		const msg = res2.userErrors.map(u => u.message).join('; ');
		throw new Error(`Failed to set back references: ${msg}`);
	}
}

async function transformFieldsForImport(fields: Record<string, unknown>, resolver: HandleResolver): Promise<Record<string, unknown>> {
	const out: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(fields)) {
		out[key] = await transformValue(val, resolver);
	}
	return out;
}

async function transformValue(val: unknown, resolver: HandleResolver): Promise<unknown> {
	if (typeof val === 'string' && val.startsWith('handle://shopify/')) {
		const id = await resolver.resolve(val);
		return id ?? val; // fallback to original if not resolved
	}
	if (Array.isArray(val)) {
		const mapped = await Promise.all(val.map(v => transformValue(v, resolver)));
		return mapped;
	}
	if (val && typeof val === 'object') {
		const inputObj = val as Record<string, unknown>;
		const obj: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(inputObj)) obj[k] = await transformValue(v, resolver);
		return obj;
	}
	return val;
}

function serialiseField(value: unknown): string {
	// If value is an object/array, serialise as JSON; else coerce to string
	if (value === null || value === undefined) return '';
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
} 