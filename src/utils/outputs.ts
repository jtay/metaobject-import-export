import fs from 'node:fs';
import path from 'node:path';
import { parseExportFile } from '@utils/schema';

export type OutputFile = {
	name: string;
	path: string;
	type: string;
	environment?: string;
	createdMs: number;
	typesPreview?: string[];
};

export function listOutputFiles(cwd: string, envNames: string[] = []): OutputFile[] {
	const dir = path.join(cwd, 'outputs');
	if (!fs.existsSync(dir)) return [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const files: OutputFile[] = [];
	for (const e of entries) {
		if (!e.isFile()) continue;
		const name = e.name;
		const filePath = path.join(dir, name);
		try {
			const stat = fs.statSync(filePath);
			const ext = path.extname(name).replace(/^\./, '').toLowerCase();
			let environment: string | undefined = undefined;
			let typesPreview: string[] | undefined = undefined;
			if (ext === 'json') {
				try {
					const text = fs.readFileSync(filePath, 'utf8');
					const parsed = parseExportFile(text);
					environment = parsed.file.environment ?? undefined;
					const sortedTypes = Object.entries(parsed.stats.byType)
						.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
						.map(([t]) => t);
					typesPreview = sortedTypes.slice(0, 5);
				} catch {
					// ignore parse errors
				}
			}
			if (!environment && envNames.length > 0) {
				const lower = name.toLowerCase();
				for (const envName of envNames) {
					if (lower.includes(envName.toLowerCase())) { environment = envName; break; }
				}
			}
			files.push({ name, path: filePath, type: ext || 'file', environment, createdMs: stat.birthtimeMs || stat.mtimeMs, typesPreview });
		} catch {
			// skip this file on error
		}
	}
	return files.sort((a, b) => b.createdMs - a.createdMs || a.name.localeCompare(b.name));
} 