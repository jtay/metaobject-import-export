import React, { createContext, useContext, useMemo, useState } from 'react';
import fs from 'node:fs';
import type { OutputFile } from '@utils/outputs';
import { parseExportFile, type ExportFile as ExportSchema, type ExportStats } from '@utils/schema';
import { runImport, type ImportProgress } from '@utils/importer';
import { createShopifyClientFromEnv } from '@utils/shopify/env';

export type ImportContextValue = {
	selected?: OutputFile;
	contentText?: string;
	parsedFile?: ExportSchema;
	stats?: ExportStats;
	isRunning: boolean;
	progress?: ImportProgress;
	selectFile: (file: OutputFile) => void;
	clear: () => void;
	confirmImport: () => void;
};

const ImportContext = createContext<ImportContextValue | undefined>(undefined);

export function ImportProvider({ children }: { children: React.ReactNode }) {
	const [selected, setSelected] = useState<OutputFile | undefined>(undefined);
	const [contentText, setContentText] = useState<string | undefined>(undefined);
	const [parsedFile, setParsedFile] = useState<ExportSchema | undefined>(undefined);
	const [stats, setStats] = useState<ExportStats | undefined>(undefined);
	const [isRunning, setIsRunning] = useState<boolean>(false);
	const [progress, setProgress] = useState<ImportProgress | undefined>(undefined);

	const selectFile = (file: OutputFile) => {
		setSelected(file);
		try {
			const text = fs.readFileSync(file.path, 'utf8');
			setContentText(text);
			try {
				const parsed = parseExportFile(text);
				setParsedFile(parsed.file);
				setStats(parsed.stats);
			} catch (e) {
				setParsedFile(undefined);
				setStats(undefined);
			}
		} catch (e) {
			setContentText(`Failed to read file: ${String(e)}`);
			setParsedFile(undefined);
			setStats(undefined);
		}
	};

	const clear = () => {
		setSelected(undefined);
		setContentText(undefined);
		setParsedFile(undefined);
		setStats(undefined);
		setIsRunning(false);
		setProgress(undefined);
	};

	const confirmImport = () => {
		if (!parsedFile || isRunning) return;
		setIsRunning(true);
		setProgress({ index: 0, total: parsedFile.count, message: 'Starting…' });
		const client = createShopifyClientFromEnv();
		void runImport(client, parsedFile, {
			onProgress: (p) => setProgress(p)
		}).then(() => {
			setIsRunning(false);
			setProgress(undefined);
		}).catch((e) => {
			setIsRunning(false);
			setProgress(prev => ({ index: prev?.index ?? 0, total: prev?.total ?? parsedFile.count, message: String(e) }));
		});
	};

	const value = useMemo<ImportContextValue>(() => ({ selected, contentText, parsedFile, stats, isRunning, progress, selectFile, clear, confirmImport }), [selected, contentText, parsedFile, stats, isRunning, progress]);

	return (
		<ImportContext.Provider value={value}>
			{children}
		</ImportContext.Provider>
	);
}

export function useImport(): ImportContextValue {
	const ctx = useContext(ImportContext);
	if (!ctx) throw new Error('useImport must be used within ImportProvider');
	return ctx;
} 