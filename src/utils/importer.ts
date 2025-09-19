import { ShopifyGraphQLClient } from '@utils/shopify/client';
import { BulkHandleResolver, type HandleRef } from '@utils/shopify/resolve';
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
	phase?: 'pre-resolve' | 'metaobjects' | 'backreferences';
	backReferencesTotal?: number;
	backReferencesProcessed?: number;
	entryCompletionStatus?: Map<number, 'metaobject-created' | 'backreferences-pending' | 'backreferences-completed' | 'failed'>;
	// New fields for pre-resolution phase
	preResolvePhase?: 'collecting' | 'resolving-products' | 'resolving-collections' | 'resolving-pages' | 'resolving-metaobjects' | 'resolving-variants' | 'complete' | 'resolving-media-images';
	preResolveTotal?: number;
	preResolveProcessed?: number;
	preResolveCurrentType?: string;
	// API statistics
	preResolveApiCalls?: number;
	preResolveResolved?: number;
	preResolveFailed?: number;
};

export type ImportOptions = {
	onProgress?: (p: ImportProgress) => void;
	skipOnError?: boolean;
};

export async function runImport(client: ShopifyGraphQLClient, file: ExportFile, opts: ImportOptions): Promise<void> {
	const resolver = new BulkHandleResolver(client);
	const entries = file.entries;
	const createdIdsByHandleKey = new Map<string, string>(); // key: type/handle -> id
	const entryCompletionStatus = new Map<number, 'metaobject-created' | 'backreferences-pending' | 'backreferences-completed' | 'failed'>();
	
	// Pre-resolve all handle references in bulk for maximum efficiency
	opts.onProgress?.({ 
		index: 0, 
		total: entries.length, 
		message: `Collecting handle references...`,
		phase: 'pre-resolve',
		preResolvePhase: 'collecting',
		preResolveTotal: 0,
		preResolveProcessed: 0,
		entryCompletionStatus
	});
	
	const allHandleRefs = collectAllHandleReferences(entries);
	if (allHandleRefs.length > 0) {
		await resolver.resolveBulk(allHandleRefs, (progress) => {
			opts.onProgress?.({
				index: 0,
				total: entries.length,
				message: progress.message || `Resolving ${progress.currentType || 'references'}...`,
				phase: 'pre-resolve',
				preResolvePhase: progress.phase,
				preResolveTotal: progress.total,
				preResolveProcessed: progress.processed,
				preResolveCurrentType: progress.currentType,
				preResolveApiCalls: progress.apiCallsCount,
				preResolveResolved: progress.resolvedCount,
				preResolveFailed: progress.failedCount,
				error: progress.error,
				entryCompletionStatus
			});
		});
	} else {
		opts.onProgress?.({ 
			index: 0, 
			total: entries.length, 
			message: `No handle references to resolve`,
			phase: 'pre-resolve',
			preResolvePhase: 'complete',
			preResolveTotal: 0,
			preResolveProcessed: 0,
			preResolveApiCalls: 0,
			preResolveResolved: 0,
			preResolveFailed: 0,
			entryCompletionStatus
		});
	}
	
	// Phase 1: Create metaobjects
	for (let i = 0; i < entries.length; i += 1) {
		const e = entries[i];
		try {
			opts.onProgress?.({ 
				index: i, 
				total: entries.length, 
				current: e, 
				message: `Upserting ${e.type}/${e.handle}`,
				phase: 'metaobjects',
				entryCompletionStatus
			});
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
			if (res.id) {
				createdIdsByHandleKey.set(`${e.type}/${e.handle}`, res.id);
				// Check if this entry has backreferences
				const hasBackReferences = (e.backReferences ?? []).length > 0;
				entryCompletionStatus.set(i, hasBackReferences ? 'backreferences-pending' : 'backreferences-completed');
			}
		} catch (err) {
			const msg = String(err);
			entryCompletionStatus.set(i, 'failed');
			if (opts.skipOnError) {
				opts.onProgress?.({ 
					index: i, 
					total: entries.length, 
					current: e, 
					message: `Skipped ${e.type}/${e.handle}`, 
					error: msg,
					phase: 'metaobjects',
					entryCompletionStatus
				});
				continue;
			}
			throw err;
		}
	}

	// Phase 2: Apply back references if present
	const pending: Array<{ ownerRef: string; namespace: string; key: string; metaobjectKey: string; entryIndex: number }> = [];
	for (let i = 0; i < entries.length; i += 1) {
		const e = entries[i];
		const brs = e.backReferences ?? [];
		for (const br of brs) {
			pending.push({ 
				ownerRef: br.owner, 
				namespace: normaliseAppNamespace(br.namespace), 
				key: br.key, 
				metaobjectKey: `${e.type}/${e.handle}`,
				entryIndex: i
			});
		}
	}
	
	if (pending.length === 0) {
		// No backreferences to process, we're done
		opts.onProgress?.({ 
			index: entries.length, 
			total: entries.length, 
			message: `Import completed`,
			phase: 'backreferences',
			backReferencesTotal: 0,
			backReferencesProcessed: 0,
			entryCompletionStatus
		});
		return;
	}

	opts.onProgress?.({ 
		index: entries.length, 
		total: entries.length, 
		message: `Processing ${pending.length} back references…`,
		phase: 'backreferences',
		backReferencesTotal: pending.length,
		backReferencesProcessed: 0,
		entryCompletionStatus
	});

	// Bulk resolve all backreference owners for maximum efficiency
	const handleRefs = pending
		.filter(p => p.ownerRef.startsWith('handle://shopify/'))
		.map(p => p.ownerRef as HandleRef);
	
	const uniqueHandleRefs = Array.from(new Set(handleRefs));
	let ownerResolutions = new Map<string, string | null>();
	
	if (uniqueHandleRefs.length > 0) {
		opts.onProgress?.({ 
			index: entries.length, 
			total: entries.length, 
			message: `Bulk resolving ${uniqueHandleRefs.length} unique backreference owners…`,
			phase: 'backreferences',
			backReferencesTotal: pending.length,
			backReferencesProcessed: 0,
			entryCompletionStatus
		});
		
		ownerResolutions = await resolver.resolveBulk(uniqueHandleRefs, (progress) => {
			opts.onProgress?.({
				index: entries.length,
				total: entries.length,
				message: progress.message || `Resolving backreference owners...`,
				phase: 'backreferences',
				backReferencesTotal: pending.length,
				backReferencesProcessed: 0,
				entryCompletionStatus
			});
		});
	}

	// Now process all backreferences using the bulk-resolved owners
	type GroupKey = string; // `${ownerId}:${namespace}:${key}` but owner might be a handle ref initially
	const groups = new Map<GroupKey, { ownerId?: string; ownerRef: string; namespace: string; key: string; metaobjectIds: string[]; entryIndices: number[] }>();
	let processedBackRefs = 0;
	
	for (const p of pending) {
		const ownerId: string | null = p.ownerRef.startsWith('handle://shopify/') 
			? ownerResolutions.get(p.ownerRef) ?? null
			: (p.ownerRef.startsWith('gid://shopify/') ? p.ownerRef : null);
		processedBackRefs++;
		
		if (processedBackRefs % 100 === 0 || processedBackRefs === pending.length) {
			opts.onProgress?.({ 
				index: entries.length, 
				total: entries.length, 
				message: `Processing back reference ${processedBackRefs}/${pending.length}…`,
				phase: 'backreferences',
				backReferencesTotal: pending.length,
				backReferencesProcessed: processedBackRefs,
				entryCompletionStatus
			});
		}
		
		if (!ownerId) {
			// Mark entry as failed for this backreference
			if (entryCompletionStatus.get(p.entryIndex) !== 'failed') {
				entryCompletionStatus.set(p.entryIndex, 'failed');
			}
			continue; // skip missing owners
		}
		const metaobjectId = createdIdsByHandleKey.get(p.metaobjectKey);
		if (!metaobjectId) {
			// Mark entry as failed for this backreference
			if (entryCompletionStatus.get(p.entryIndex) !== 'failed') {
				entryCompletionStatus.set(p.entryIndex, 'failed');
			}
			continue; // metaobject not created? skip
		}
		const gk = `${ownerId}:${p.namespace}:${p.key}`;
		if (!groups.has(gk)) groups.set(gk, { ownerId, ownerRef: p.ownerRef, namespace: p.namespace, key: p.key, metaobjectIds: [], entryIndices: [] });
		const group = groups.get(gk)!;
		group.metaobjectIds.push(metaobjectId);
		group.entryIndices.push(p.entryIndex);
	}

	const items: { ownerId: string; namespace: string; key: string; ids?: string[]; id?: string; entryIndices: number[] }[] = [];
	for (const g of groups.values()) {
		const unique = Array.from(new Set(g.metaobjectIds));
		if (unique.length === 0 || !g.ownerId) continue;
		if (unique.length === 1) {
			items.push({ ownerId: g.ownerId, namespace: g.namespace, key: g.key, id: unique[0], entryIndices: g.entryIndices });
		} else {
			items.push({ ownerId: g.ownerId, namespace: g.namespace, key: g.key, ids: unique, entryIndices: g.entryIndices });
		}
	}
	
	if (items.length === 0) {
		opts.onProgress?.({ 
			index: entries.length, 
			total: entries.length, 
			message: `No valid back references to apply`,
			phase: 'backreferences',
			backReferencesTotal: pending.length,
			backReferencesProcessed: pending.length,
			entryCompletionStatus
		});
		return;
	}

	opts.onProgress?.({ 
		index: entries.length, 
		total: entries.length, 
		message: `Applying ${items.length} back reference groups…`,
		phase: 'backreferences',
		backReferencesTotal: pending.length,
		backReferencesProcessed: pending.length,
		entryCompletionStatus
	});

	const res2 = await metafieldsSetBatch(client, items);
	if (res2.userErrors.length) {
		const msg = res2.userErrors.map(u => u.message).join('; ');
		// Mark affected entries as failed
		for (const item of items) {
			for (const entryIndex of item.entryIndices) {
				entryCompletionStatus.set(entryIndex, 'failed');
			}
		}
		if (opts.skipOnError) {
			opts.onProgress?.({ 
				index: entries.length, 
				total: entries.length, 
				message: `Skipped setting some back references`, 
				error: msg,
				phase: 'backreferences',
				backReferencesTotal: pending.length,
				backReferencesProcessed: pending.length,
				entryCompletionStatus
			});
			return;
		}
		throw new Error(`Failed to set back references: ${msg}`);
	}
	
	// Mark all successfully processed entries as completed
	for (const item of items) {
		for (const entryIndex of item.entryIndices) {
			if (entryCompletionStatus.get(entryIndex) === 'backreferences-pending') {
				entryCompletionStatus.set(entryIndex, 'backreferences-completed');
			}
		}
	}
	
	opts.onProgress?.({ 
		index: entries.length, 
		total: entries.length, 
		message: `Import completed`,
		phase: 'backreferences',
		backReferencesTotal: pending.length,
		backReferencesProcessed: pending.length,
		entryCompletionStatus
	});
}

export async function runImportOne(client: ShopifyGraphQLClient, file: ExportFile, index: number, opts: ImportOptions): Promise<void> {
	const resolver = new BulkHandleResolver(client);
	const entries = file.entries;
	const e = entries[index];
	if (!e) return;
	
	const entryCompletionStatus = new Map<number, 'metaobject-created' | 'backreferences-pending' | 'backreferences-completed' | 'failed'>();
	
	// Pre-resolve handle references for this entry
	const handleRefs = collectAllHandleReferences([e]);
	if (handleRefs.length > 0) {
		opts.onProgress?.({ 
			index, 
			total: entries.length, 
			current: e, 
			message: `Collecting handle references...`,
			phase: 'pre-resolve',
			preResolvePhase: 'collecting',
			preResolveTotal: 0,
			preResolveProcessed: 0,
			entryCompletionStatus
		});
		
		await resolver.resolveBulk(handleRefs, (progress) => {
			opts.onProgress?.({
				index,
				total: entries.length,
				current: e,
				message: progress.message || `Resolving ${progress.currentType || 'references'}...`,
				phase: 'pre-resolve',
				preResolvePhase: progress.phase,
				preResolveTotal: progress.total,
				preResolveProcessed: progress.processed,
				preResolveCurrentType: progress.currentType,
				preResolveApiCalls: progress.apiCallsCount,
				preResolveResolved: progress.resolvedCount,
				preResolveFailed: progress.failedCount,
				error: progress.error,
				entryCompletionStatus
			});
		});
	}
	
	opts.onProgress?.({ 
		index, 
		total: entries.length, 
		current: e, 
		message: `Matching handles…`,
		phase: 'metaobjects',
		entryCompletionStatus
	});
	try {
		const fields = await transformFieldsForImport(e.fields, resolver);
		const inputFields = Object.entries(fields)
			.filter(([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0))
			.map(([key, value]) => ({ key, value: serialiseField(value) }));
		opts.onProgress?.({ 
			index, 
			total: entries.length, 
			current: e, 
			message: `Creating entry…`,
			phase: 'metaobjects',
			entryCompletionStatus
		});
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
			entryCompletionStatus.set(index, 'backreferences-pending');
			opts.onProgress?.({ 
				index, 
				total: entries.length, 
				current: e, 
				message: `Processing ${brs.length} back references…`,
				phase: 'backreferences',
				backReferencesTotal: brs.length,
				backReferencesProcessed: 0,
				entryCompletionStatus
			});
			
			// Bulk resolve backreference owners for this entry
			const handleRefs = brs
				.filter(br => br.owner.startsWith('handle://shopify/'))
				.map(br => br.owner as HandleRef);
			
			const uniqueHandleRefs = Array.from(new Set(handleRefs));
			let ownerResolutions = new Map<string, string | null>();
			
			if (uniqueHandleRefs.length > 0) {
				opts.onProgress?.({ 
					index, 
					total: entries.length, 
					current: e, 
					message: `Bulk resolving ${uniqueHandleRefs.length} unique backreference owners…`,
					phase: 'backreferences',
					backReferencesTotal: brs.length,
					backReferencesProcessed: 0,
					entryCompletionStatus
				});
				
				ownerResolutions = await resolver.resolveBulk(uniqueHandleRefs);
			}
			
			// Resolve owners and set metafields for this entry only
			const items: { ownerId: string; namespace: string; key: string; ids?: string[]; id?: string }[] = [];
			// Group by owner/namespace/key
			const groups = new Map<string, { ownerId: string; namespace: string; key: string; metaobjectIds: string[] }>();
			let processedBackRefs = 0;
			
			for (const br of brs) {
				processedBackRefs++;
				if (processedBackRefs % 10 === 0 || processedBackRefs === brs.length) {
					opts.onProgress?.({ 
						index, 
						total: entries.length, 
						current: e, 
						message: `Processing back reference ${processedBackRefs}/${brs.length}…`,
						phase: 'backreferences',
						backReferencesTotal: brs.length,
						backReferencesProcessed: processedBackRefs,
						entryCompletionStatus
					});
				}
				
				const ownerId = br.owner.startsWith('handle://shopify/') 
					? ownerResolutions.get(br.owner) ?? null
					: (br.owner.startsWith('gid://shopify/') ? br.owner : null);
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
				opts.onProgress?.({ 
					index, 
					total: entries.length, 
					current: e, 
					message: `Applying ${items.length} back reference groups…`,
					phase: 'backreferences',
					backReferencesTotal: brs.length,
					backReferencesProcessed: brs.length,
					entryCompletionStatus
				});
				
				const res2 = await metafieldsSetBatch(client, items);
				if (res2.userErrors.length) {
					const msg = res2.userErrors.map(u => u.message).join('; ');
					entryCompletionStatus.set(index, 'failed');
					if (!opts.skipOnError) throw new Error(`Failed to set back references: ${msg}`);
				} else {
					entryCompletionStatus.set(index, 'backreferences-completed');
				}
			} else {
				entryCompletionStatus.set(index, 'backreferences-completed');
			}
		} else {
			// No backreferences, mark as completed
			entryCompletionStatus.set(index, 'backreferences-completed');
		}
		
		opts.onProgress?.({ 
			index, 
			total: entries.length, 
			current: e, 
			message: `Entry completed`,
			phase: 'backreferences',
			entryCompletionStatus
		});
		
	} catch (err) {
		const msg = String(err);
		entryCompletionStatus.set(index, 'failed');
		if (opts.skipOnError) {
			opts.onProgress?.({ 
				index, 
				total: entries.length, 
				current: e, 
				message: `Skipped ${e.type}/${e.handle}`, 
				error: msg,
				entryCompletionStatus
			});
			return;
		}
		throw err;
	}
}

async function transformFieldsForImport(fields: Record<string, unknown>, resolver: BulkHandleResolver): Promise<Record<string, unknown>> {
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

async function transformValue(val: unknown, resolver: BulkHandleResolver): Promise<unknown> {
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

function collectAllHandleReferences(entries: ExportEntry[]): HandleRef[] {
	const refs = new Set<HandleRef>();
	
	for (const entry of entries) {
		// Collect references from entry fields
		collectHandleRefsFromValue(entry.fields, refs);
		
		// Collect references from backreferences
		for (const br of entry.backReferences ?? []) {
			if (br.owner.startsWith('handle://shopify/')) {
				refs.add(br.owner as HandleRef);
			}
		}
	}
	
	return Array.from(refs);
}

function collectHandleRefsFromValue(value: unknown, refs: Set<HandleRef>): void {
	if (typeof value === 'string') {
		if (value.startsWith('handle://shopify/')) {
			refs.add(value as HandleRef);
		} else if (value.startsWith('[') || value.startsWith('{')) {
			// Try to parse JSON that might contain handle refs
			try {
				const parsed = JSON.parse(value);
				collectHandleRefsFromValue(parsed, refs);
			} catch {
				// Not valid JSON, ignore
			}
		}
	} else if (Array.isArray(value)) {
		for (const item of value) {
			collectHandleRefsFromValue(item, refs);
		}
	} else if (value && typeof value === 'object') {
		for (const v of Object.values(value as Record<string, unknown>)) {
			collectHandleRefsFromValue(v, refs);
		}
	}
} 