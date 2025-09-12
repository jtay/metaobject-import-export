export type ExportEntry = {
	handle: string;
	type: string;
	fields: Record<string, unknown>;
	backReferences?: Array<BackReference>;
};

export type ExportFile = {
	environment?: string;
	count: number;
	entries: ExportEntry[];
};

export type ExportStats = {
	total: number;
	byType: Record<string, number>;
};

export type BackReference = {
	ownerType: 'Product' | 'ProductVariant' | 'Collection' | 'Page';
	owner: string; // gid://... or handle://...
	namespace: string;
	key: string;
};

export function normaliseMetaobjectType(type: string): string {
	const regex = /^(.+?)--\d+--(.+)$/;
	// Ensure leading $ for app namespace
	const replaced = type.replace(regex, '$$$1:$2');
	return replaced;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isOwnerType(value: unknown): value is BackReference['ownerType'] {
	return value === 'Product' || value === 'ProductVariant' || value === 'Collection' || value === 'Page';
}

export function parseExportFile(text: string): { file: ExportFile; stats: ExportStats } {
	const rawUnknown = JSON.parse(text) as unknown;
	const raw = isRecord(rawUnknown) ? rawUnknown : {} as Record<string, unknown>;

	const entriesUnknown = (raw as Record<string, unknown>).entries as unknown;
	const rawEntries = Array.isArray(entriesUnknown) ? (entriesUnknown as unknown[]) : [];

	const entries: ExportEntry[] = rawEntries.map((eUnknown) => {
		const e = isRecord(eUnknown) ? eUnknown : {} as Record<string, unknown>;
		const fieldsVal = e.fields as unknown;
		const fields = isRecord(fieldsVal) ? (fieldsVal as Record<string, unknown>) : {};

		const backRefsVal = e.backReferences as unknown;
		const backRefs = Array.isArray(backRefsVal) ? backRefsVal : undefined;
		const backReferences = backRefs ? backRefs.map((brUnknown) => {
			const br = isRecord(brUnknown) ? brUnknown : {} as Record<string, unknown>;
			const ownerType = isOwnerType(br.ownerType) ? br.ownerType : 'Product';
			return {
				ownerType,
				owner: String(br.owner ?? ''),
				namespace: String(br.namespace ?? ''),
				key: String(br.key ?? '')
			};
		}).filter((br) => br.owner && br.namespace && br.key) : undefined;

		return {
			handle: String((e as Record<string, unknown>).handle ?? ''),
			type: normaliseMetaobjectType(String((e as Record<string, unknown>).type ?? 'unknown')),
			fields,
			backReferences
		};
	});

	const environment = typeof (raw as Record<string, unknown>).environment === 'string' ? String((raw as Record<string, unknown>).environment) : undefined;
	const countRaw = (raw as Record<string, unknown>).count as unknown;
	const countParsed = typeof countRaw === 'number' ? countRaw : Number.isFinite(Number(countRaw)) ? Number(countRaw) : undefined;
	const file: ExportFile = {
		environment,
		count: countParsed ?? entries.length,
		entries
	};
	if (!Number.isFinite(file.count) || file.count !== entries.length) file.count = entries.length;
	const stats: ExportStats = {
		total: entries.length,
		byType: entries.reduce<Record<string, number>>((acc, e) => {
			const key = e.type || 'unknown';
			acc[key] = (acc[key] ?? 0) + 1;
			return acc;
		}, {})
	};
	return { file, stats };
} 