import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import type { OutputFile } from '@utils/outputs';
import { parseExportFile, type ExportFile as ExportSchema, type ExportStats } from '@utils/schema';
import { runImport, type ImportProgress, runImportOne } from '@utils/importer';
import { createShopifyClientFromEnv } from '@utils/shopify/env';

export type ImportResult = { status: 'success' | 'skipped' | 'failed'; error?: string };

export type ImportContextValue = {
	selected?: OutputFile;
	contentText?: string;
	parsedFile?: ExportSchema;
	stats?: ExportStats;
	isRunning: boolean;
	progress?: ImportProgress;
	processed: Set<number>;
	failed: Map<number, string>;
	skipOnError: boolean;
	results: Map<number, ImportResult>;
	entryCompletionStatus: Map<number, 'metaobject-created' | 'backreferences-pending' | 'backreferences-completed' | 'failed'>;
	selectFile: (file: OutputFile) => void;
	clear: () => void;
	confirmImport: () => void;
	importOne: (index: number) => void;
	toggleSkipOnError: () => void;
};

const ImportContext = createContext<ImportContextValue | undefined>(undefined);

export function ImportProvider({ children }: { children: React.ReactNode }) {
	const [selected, setSelected] = useState<OutputFile | undefined>(undefined);
	const [contentText, setContentText] = useState<string | undefined>(undefined);
	const [parsedFile, setParsedFile] = useState<ExportSchema | undefined>(undefined);
	const [stats, setStats] = useState<ExportStats | undefined>(undefined);
	const [isRunning, setIsRunning] = useState<boolean>(false);
	const [progress, setProgress] = useState<ImportProgress | undefined>(undefined);
	const [processed, setProcessed] = useState<Set<number>>(new Set());
	const [failed, setFailed] = useState<Map<number, string>>(new Map());
	const [skipOnError, setSkipOnError] = useState<boolean>(false);
	const [results, setResults] = useState<Map<number, ImportResult>>(new Map());
	const [entryCompletionStatus, setEntryCompletionStatus] = useState<Map<number, 'metaobject-created' | 'backreferences-pending' | 'backreferences-completed' | 'failed'>>(new Map());

	const selectFile = (file: OutputFile) => {
		setSelected(file);
		try {
			const text = fs.readFileSync(file.path, 'utf8');
			setContentText(text);
			try {
				const parsed = parseExportFile(text);
				setParsedFile(parsed.file);
				setStats(parsed.stats);
				setProcessed(new Set());
				setFailed(new Map());
				setResults(new Map());
				setEntryCompletionStatus(new Map());
			} catch {
				setParsedFile(undefined);
				setStats(undefined);
				setProcessed(new Set());
				setFailed(new Map());
				setResults(new Map());
				setEntryCompletionStatus(new Map());
			}
		} catch (err) {
			setContentText(`Failed to read file: ${String(err)}`);
			setParsedFile(undefined);
			setStats(undefined);
			setProcessed(new Set());
			setFailed(new Map());
			setResults(new Map());
			setEntryCompletionStatus(new Map());
		}
	};

	const clear = () => {
		setSelected(undefined);
		setContentText(undefined);
		setParsedFile(undefined);
		setStats(undefined);
		setIsRunning(false);
		setProgress(undefined);
		setProcessed(new Set());
		setFailed(new Map());
		setResults(new Map());
		setEntryCompletionStatus(new Map());
	};

	const confirmImport = useCallback(() => {
		if (!parsedFile || isRunning) return;
		setIsRunning(true);
		const startedAt = new Date();
		setProgress({ index: 0, total: parsedFile.count, message: 'Starting…' });
		const client = createShopifyClientFromEnv();
		void runImport(client, parsedFile, {
			onProgress: (p) => {
				setProgress(p);
				
				// Update entry completion status if provided
				if (p.entryCompletionStatus) {
					setEntryCompletionStatus(new Map(p.entryCompletionStatus));
				}
				
				// Mark entries as processed only when they are fully completed (including backreferences)
				if (p.entryCompletionStatus) {
					const newProcessed = new Set<number>();
					for (const [index, status] of p.entryCompletionStatus) {
						if (status === 'backreferences-completed') {
							newProcessed.add(index);
						}
					}
					setProcessed(newProcessed);
				}
				
				// Handle errors and failures
				if (p.error && Number.isFinite(p.index)) {
					setFailed(prev => {
						const m = new Map(prev);
						m.set(p.index, p.error!);
						return m;
					});
					setResults(prev => {
						const m = new Map(prev);
						m.set(p.index, { status: 'failed', error: p.error });
						return m;
					});
				} else if (Number.isFinite(p.index) && p.message?.startsWith('Skipped')) {
					setResults(prev => { const m = new Map(prev); m.set(p.index, { status: 'skipped', error: p.error }); return m; });
				}
			},
			skipOnError
		}).then(() => {
			// Mark all completed entries as processed on completion
			if (parsedFile) {
				const allCompleted = new Set<number>();
				for (let i = 0; i < parsedFile.count; i += 1) {
					const status = entryCompletionStatus.get(i);
					if (status === 'backreferences-completed') {
						allCompleted.add(i);
					}
				}
				setProcessed(allCompleted);
			}
			setIsRunning(false);
			setProgress(undefined);
			// Persist summary
			try {
				const finishedAt = new Date();
				const env = parsedFile?.environment ?? selected?.environment ?? 'unknown';
				const entries = parsedFile?.entries ?? [];
				const summary = {
					environment: env,
					startedAt: startedAt.toISOString(),
					finishedAt: finishedAt.toISOString(),
					count: entries.length,
					results: entries.map((e, idx) => {
						const r = results.get(idx);
						const status = entryCompletionStatus.get(idx);
						return { 
							index: idx, 
							type: e.type, 
							handle: e.handle, 
							status: r?.status ?? (status === 'backreferences-completed' ? 'success' : 'pending'), 
							completionStatus: status,
							error: r?.error 
						};
					})
				};
				const dir = path.join(process.cwd(), 'outputs');
				fs.mkdirSync(dir, { recursive: true });
				const fileName = `${env}-import-results-${finishedAt.toISOString().replace(/[:.]/g, '-')}.json`;
				fs.writeFileSync(path.join(dir, fileName), JSON.stringify(summary, null, 2), 'utf8');
			} catch {
				// ignore persistence errors
			}
		}).catch((e) => {
			setIsRunning(false);
			setProgress(() => ({ index: 0, total: parsedFile?.count ?? 0, message: String(e) }));
		});
	}, [parsedFile, isRunning, skipOnError, results, selected, entryCompletionStatus]);

	const importOne = useCallback((index: number) => {
		if (!parsedFile || isRunning) return;
		setIsRunning(true);
		setProgress({ index, total: parsedFile.count, current: parsedFile.entries[index], message: 'Starting…' });
		const client = createShopifyClientFromEnv();
		void runImportOne(client, parsedFile, index, {
			onProgress: (p) => {
				setProgress(p);
				
				// Update entry completion status if provided
				if (p.entryCompletionStatus) {
					setEntryCompletionStatus(prev => {
						const m = new Map(prev);
						for (const [idx, status] of p.entryCompletionStatus) {
							m.set(idx, status);
						}
						return m;
					});
				}
				
				if (p.error) {
					setFailed(prev => {
						const m = new Map(prev);
						m.set(index, p.error!);
						return m;
					});
					setResults(prev => { const m = new Map(prev); m.set(index, { status: 'failed', error: p.error }); return m; });
				}
			},
			skipOnError
		}).then(() => {
			setIsRunning(false);
			setProgress(undefined);
			// Only mark as processed if fully completed (including backreferences)
			const status = entryCompletionStatus.get(index);
			if (status === 'backreferences-completed') {
				setProcessed(prev => {
					const newSet = new Set(prev);
					newSet.add(index);
					return newSet;
				});
				setResults(prev => { const m = new Map(prev); m.set(index, { status: 'success' }); return m; });
			}
		}).catch((e) => {
			setIsRunning(false);
			setProgress(() => ({ index: index, total: parsedFile.count, message: String(e) }));
			setFailed(prev => {
				const m = new Map(prev);
				m.set(index, String(e));
				return m;
			});
			setResults(prev => { const m = new Map(prev); m.set(index, { status: 'failed', error: String(e) }); return m; });
			setEntryCompletionStatus(prev => {
				const m = new Map(prev);
				m.set(index, 'failed');
				return m;
			});
		});
	}, [parsedFile, isRunning, skipOnError, entryCompletionStatus]);

	const toggleSkipOnError = useCallback(() => setSkipOnError(v => !v), []);

	const value = useMemo<ImportContextValue>(() => ({ selected, contentText, parsedFile, stats, isRunning, progress, processed, failed, skipOnError, results, entryCompletionStatus, selectFile, clear, confirmImport, importOne, toggleSkipOnError }), [selected, contentText, parsedFile, stats, isRunning, progress, processed, failed, skipOnError, results, entryCompletionStatus, confirmImport, importOne, toggleSkipOnError]);

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