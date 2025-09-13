import { ShopifyGraphQLClient } from '@utils/shopify/client';
import { HandleResolver } from '@utils/shopify/resolve';
import type { ExportFile, ExportEntry } from '@utils/schema';
import { normaliseAppNamespace } from '@utils/schema';
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
	skipOnError?: boolean;
};

export async function runImport(client: ShopifyGraphQLClient, file: ExportFile, opts: ImportOptions): Promise<void> {
	const resolver = new HandleResolver(client);
	const entries = file.entries;
	const createdIdsByHandleKey = new Map<string, string>(); // key: type/handle -> id
	for (let i = 0; i < entries.length; i += 1) {
		const e = entries[i];
		try {
			opts.onProgress?.({ index: i, total: entries.length, current: e, message: `Upserting ${e.type}/${e.handle}` });
			const fields = await transformFieldsForImport(e.fields, resolver);
			const inputFields = Object.entries(fields)
				.filter(([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0))
				.map(([key, value]) => ({ key, value: serialiseField(value) }));
			const input = {
				handle: { type: e.type, handle: e.handle },
				metaobject: { fields: inputFields }
			};
			const res = await upsertMetaobject(client, input);
			if (res.userErrors && res.userErrors.length) {
				throw new Error(`Failed to upsert ${e.type}/${e.handle}: ${res.userErrors.map(u => u.message).join('; ')}`);
			}
			if (res.id) createdIdsByHandleKey.set(`${e.type}/${e.handle}`, res.id);
		} catch (err) {
			const msg = String(err);
			if (opts.skipOnError) {
				opts.onProgress?.({ index: i, total: entries.length, current: e, message: `Skipped ${e.type}/${e.handle}`, error: msg });
				continue;
			}
			throw err;
		}
	}

	// Post-pass: apply back references if present
	const pending: Array<{ ownerRef: string; namespace: string; key: string; metaobjectKey: string }> = [];
	for (const e of entries) {
		const brs = e.backReferences ?? [];
		for (const br of brs) {
			pending.push({ ownerRef: br.owner, namespace: normaliseAppNamespace(br.namespace), key: br.key, metaobjectKey: `${e.type}/${e.handle}` });
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
		if (opts.skipOnError) {
			opts.onProgress?.({ index: entries.length, total: entries.length, message: `Skipped setting some back references`, error: msg });
			return;
		}
		throw new Error(`Failed to set back references: ${msg}`);
	}
}

export async function runImportOne(client: ShopifyGraphQLClient, file: ExportFile, index: number, opts: ImportOptions): Promise<void> {
	const resolver = new HandleResolver(client);
	const entries = file.entries;
	const e = entries[index];
	if (!e) return;
	opts.onProgress?.({ index, total: entries.length, current: e, message: `Matching handles…` });
	try {
		const fields = await transformFieldsForImport(e.fields, resolver);
		const inputFields = Object.entries(fields)
			.filter(([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0))
			.map(([key, value]) => ({ key, value: serialiseField(value) }));
		opts.onProgress?.({ index, total: entries.length, current: e, message: `Creating entry…` });
		const input = {
			handle: { type: e.type, handle: e.handle },
			metaobject: { fields: inputFields }
		};
		const res = await upsertMetaobject(client, input);
		if (res.userErrors && res.userErrors.length) {
			throw new Error(`Failed to upsert ${e.type}/${e.handle}: ${res.userErrors.map(u => u.message).join('; ')}`);
		}
		const createdId = res.id;
		const brs = e.backReferences ?? [];
		if (createdId && brs.length > 0) {
			opts.onProgress?.({ index, total: entries.length, current: e, message: `Setting back references…` });
			// Resolve owners and set metafields for this entry only
			const items: { ownerId: string; namespace: string; key: string; ids?: string[]; id?: string }[] = [];
			// Group by owner/namespace/key
			const groups = new Map<string, { ownerId: string; namespace: string; key: string; metaobjectIds: string[] }>();
			for (const br of brs) {
				const ownerId = br.owner.startsWith('handle://shopify/') ? await resolver.resolve(br.owner) : (br.owner.startsWith('gid://shopify/') ? br.owner : null);
				if (!ownerId) continue;
				const ns = normaliseAppNamespace(br.namespace);
				const gk = `${ownerId}:${ns}:${br.key}`;
				if (!groups.has(gk)) groups.set(gk, { ownerId, namespace: ns, key: br.key, metaobjectIds: [] });
				groups.get(gk)!.metaobjectIds.push(createdId);
			}
			for (const g of groups.values()) {
				const uniques = Array.from(new Set(g.metaobjectIds));
				if (uniques.length === 1) items.push({ ownerId: g.ownerId, namespace: g.namespace, key: g.key, id: uniques[0] });
				else items.push({ ownerId: g.ownerId, namespace: g.namespace, key: g.key, ids: uniques });
			}
			if (items.length > 0) {
				const res2 = await metafieldsSetBatch(client, items);
				if (res2.userErrors.length) {
					const msg = res2.userErrors.map(u => u.message).join('; ');
					if (!opts.skipOnError) throw new Error(`Failed to set back references: ${msg}`);
				}
			}
		}
	} catch (err) {
		const msg = String(err);
		if (opts.skipOnError) {
			opts.onProgress?.({ index, total: entries.length, current: e, message: `Skipped ${e.type}/${e.handle}`, error: msg });
			return;
		}
		throw err;
	}
}

async function transformFieldsForImport(fields: Record<string, unknown>, resolver: HandleResolver): Promise<Record<string, unknown>> {
	const out: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(fields)) {
		const transformed = await transformValue(val, resolver);
		if (transformed !== undefined && !(Array.isArray(transformed) && transformed.length === 0)) {
			out[key] = transformed;
		}
	}
	return out;
}

function tryParseJson(text: string): unknown | undefined {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

async function transformValue(val: unknown, resolver: HandleResolver): Promise<unknown> {
	if (typeof val === 'string') {
		// Direct handle ref string
		if (val.startsWith('handle://shopify/')) {
			const id = await resolver.resolve(val);
			return id ?? undefined; // skip unresolved
		}
		// JSON-encoded array/object that may contain handle refs
		if ((val.startsWith('[') || val.startsWith('{'))) {
			const parsed = tryParseJson(val);
			if (parsed !== undefined) return await transformValue(parsed, resolver);
		}
	}
	if (Array.isArray(val)) {
		const mapped = await Promise.all(val.map(v => transformValue(v, resolver)));
		return mapped.filter(v => v !== undefined);
	}
	if (val && typeof val === 'object') {
		const inputObj = val as Record<string, unknown>;
		const obj: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(inputObj)) {
			const t = await transformValue(v, resolver);
			if (t !== undefined && !(Array.isArray(t) && t.length === 0)) obj[k] = t;
		}
		return Object.keys(obj).length > 0 ? obj : undefined;
	}
	return val;
}

function serialiseField(value: unknown): string {
	// If value is an object/array, serialise as JSON; else coerce to string
	if (value === null || value === undefined) return '';
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
} 