import fs from 'node:fs';
import path from 'node:path';
import type { EnvironmentFile } from '@context/EnvironmentContext';

export function listEnvFiles(cwd: string): EnvironmentFile[] {
	const entries = fs.readdirSync(cwd, { withFileTypes: true });
	const envFiles = entries
		.filter((e) => e.isFile() && e.name.startsWith('.env'))
		.map((e) => ({ name: e.name, path: path.join(cwd, e.name) }))
		.sort((a, b) => a.name.localeCompare(b.name));
	return envFiles;
} 