import fs from 'node:fs';
import path from 'node:path';
import { ShopifyGraphQLClient } from '@utils/shopify/client';
import { fetchAllMetaobjects, extractHandleRefsFromFields, isGid, type MetaobjectNode } from '@utils/shopify/metaobjects';
import type { ExportFile, ExportEntry } from '@utils/schema';
import { normaliseMetaobjectType } from '@utils/schema';

export type ExportProgress = {
	phase: 'fetch' | 'write';
	message: string;
	count?: number;
	total?: number;
	currentType?: string;
};

export type ExportOptions = {
	cwd: string;
	environmentFileName: string; // e.g. .env.development
	types: string[];
	retainIds: boolean;
	onProgress?: (p: ExportProgress) => void;
};

export async function runExport(client: ShopifyGraphQLClient, opts: ExportOptions): Promise<string> {
	const allEntries: ExportEntry[] = [];
	const dependsOnMap = new Map<string, Set<string>>(); // key:type/handle -> set of handle refs

	for (const type of opts.types) {
		opts.onProgress?.({ phase: 'fetch', message: `Fetching ${type}…`, currentType: type });
		const nodes = await fetchAllMetaobjects(client, type);
		opts.onProgress?.({ phase: 'fetch', message: `Fetched ${nodes.length} of ${type}`, currentType: type, count: nodes.length });
		for (const node of nodes) {
			const key = `${node.type}/${node.handle}`;
			const entry: ExportEntry = {
				handle: node.handle,
				type: normaliseMetaobjectType(node.type),
				fields: {} as Record<string, unknown>
			};

			const deps = new Set<string>();
			for (const f of node.fields) {
				const value = normaliseFieldForExport(node, f, opts.retainIds, deps);
				(entry.fields as any)[f.key] = value;
			}
			if (deps.size > 0) dependsOnMap.set(key, deps);
			allEntries.push(entry);
		}
	}

	const ordered = topoSortEntries(allEntries, dependsOnMap);

	const out: ExportFile & { dependsOn?: Record<string, string[]> } = {
		environment: opts.environmentFileName,
		count: ordered.length,
		entries: ordered
	};

	opts.onProgress?.({ phase: 'write', message: 'Writing output…', total: ordered.length });
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const base = opts.types.join('+');
	const fileName = `${opts.environmentFileName}-${base}-${timestamp}.json`;
	const outDir = path.join(opts.cwd, 'outputs');
	fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(path.join(outDir, fileName), JSON.stringify(out, null, 2));
	return path.join(outDir, fileName);
}

function normaliseFieldForExport(node: MetaobjectNode, field: MetaobjectNode['fields'][number], retainIds: boolean, deps: Set<string>): unknown {
	// Prefer jsonValue when present for structured fields
	const baseValue: unknown = field.jsonValue ?? field.value ?? null;

	if (retainIds) return baseValue;

	// Convert references to handle refs when possible
	const handleRefs = extractHandleRefsFromFields([field]);
	if (handleRefs.length > 0) {
		for (const ref of handleRefs) deps.add(ref);
		if (field.references?.nodes && field.references.nodes.length > 0) return handleRefs;
		return handleRefs[0];
	}

	// If it's a plain string gid, convert to a stub so it's clearly external
	if (typeof baseValue === 'string' && isGid(baseValue)) {
		deps.add(baseValue);
		return baseValue;
	}
	return baseValue;
}

function topoSortEntries(entries: ExportEntry[], dependsOnMap: Map<string, Set<string>>): ExportEntry[] {
	// Only consider metaobject dependencies expressed as handle://shopify/Metaobject/<type>/<handle>
	const keyFor = (e: ExportEntry) => `handle://shopify/Metaobject/${e.type}/${e.handle}`;
	const inDegree = new Map<string, number>();
	const graph = new Map<string, Set<string>>();
	const entryByKey = new Map<string, ExportEntry>();

	for (const e of entries) {
		const k = keyFor(e);
		entryByKey.set(k, e);
		inDegree.set(k, 0);
		graph.set(k, new Set());
	}

	for (const [k, deps] of dependsOnMap) {
		const fromKey = `handle://shopify/Metaobject/${k}`; // k is type/handle
		for (const dep of deps) {
			if (typeof dep === 'string' && dep.startsWith('handle://shopify/Metaobject/')) {
				const toKey = dep;
				if (!graph.has(toKey)) continue; // external or missing
				graph.get(toKey)!.add(fromKey);
				inDegree.set(fromKey, (inDegree.get(fromKey) ?? 0) + 1);
			}
		}
	}

	const queue: string[] = [];
	for (const [k, deg] of inDegree) if ((deg ?? 0) === 0) queue.push(k);
	const ordered: string[] = [];
	while (queue.length) {
		const k = queue.shift()!;
		ordered.push(k);
		for (const to of graph.get(k) ?? []) {
			const d = (inDegree.get(to) ?? 0) - 1;
			inDegree.set(to, d);
			if (d === 0) queue.push(to);
		}
	}

	// Append any remaining nodes (cycles or unresolved) in original order
	const unresolved = entries.map(keyFor).filter(k => !ordered.includes(k));
	const allKeys = ordered.concat(unresolved);
	return allKeys.map(k => entryByKey.get(k)!).filter(Boolean);
} 