import { ShopifyGraphQLClient } from '@utils/shopify/client';
import { HandleResolver } from '@utils/shopify/resolve';
import type { ExportFile, ExportEntry } from '@utils/schema';
import { upsertMetaobject } from '@utils/shopify/metaobjects';

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
		const obj: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(val as any)) obj[k] = await transformValue(v, resolver);
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