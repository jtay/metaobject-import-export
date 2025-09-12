export type ExportEntry = {
	handle: string;
	type: string;
	fields: Record<string, unknown>;
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

export function normaliseMetaobjectType(type: string): string {
	const regex = /^(.+?)--\d+--(.+)$/;
	// Ensure leading $ for app namespace
	const replaced = type.replace(regex, '$$$1:$2');
	return replaced;
}

export function parseExportFile(text: string): { file: ExportFile; stats: ExportStats } {
	const raw = JSON.parse(text);
	const entries: ExportEntry[] = Array.isArray(raw?.entries) ? raw.entries.map((e: any) => ({
		handle: String(e?.handle ?? ''),
		type: normaliseMetaobjectType(String(e?.type ?? 'unknown')),
		fields: typeof e?.fields === 'object' && e?.fields !== null ? e.fields : {}
	})) : [];
	const file: ExportFile = {
		environment: typeof raw?.environment === 'string' ? raw.environment : undefined,
		count: Number.isFinite(raw?.count) ? Number(raw.count) : entries.length,
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