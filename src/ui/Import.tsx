import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { useImport } from '@context/ImportContext';
import { useFocusRegion } from '@context/FocusContext';
import { useNavigation } from '@context/NavigationContext';
import { useEnvironment } from '@context/EnvironmentContext';
import { listOutputFiles, type OutputFile } from '@utils/outputs';
import { WizardHeader } from '@ui/components/WizardHeader';
import { Panel } from '@ui/components/Panel';
import { Table, type Column } from '@ui/components/Table';

export function Import() {
	useFocusRegion('page:import', true);
	const { selected, contentText, parsedFile, stats, confirmImport, importOne, isRunning, progress, selectFile, failed, skipOnError, toggleSkipOnError, entryCompletionStatus } = useImport();
	const { navigate } = useNavigation();
	const { availableEnvs } = useEnvironment();

	// Steps: 1=Select, 2=Preview
	const initialStep = selected ? 2 : 1;
	const [step, setStep] = useState<number>(initialStep);

	// Step 1 state
	const envNames = useMemo(() => availableEnvs.map(e => e.name.replace(/^\.env\./, '')), [availableEnvs]);
	const [files, setFiles] = useState<OutputFile[]>([]);
	const [listIndex, setListIndex] = useState<number>(0);

	useEffect(() => {
		const cwd = process.cwd();
		const list = listOutputFiles(cwd, envNames);
		setFiles(list);
		setListIndex(0);
	}, [envNames]);

	// Step 2 state: preview (3 columns)
	const [viewMode, setViewMode] = useState<'table' | 'json'>('table');
	const pretty = useMemo(() => {
		if (!contentText) return '';
		try {
			const parsed = JSON.parse(contentText);
			return JSON.stringify(parsed, null, 2);
		} catch {
			return contentText ?? '';
		}
	}, [contentText]);
	const lines = useMemo(() => pretty.split(/\r?\n/), [pretty]);
	const { stdout } = useStdout();
	const columns = stdout?.columns ?? 120;
	const widthThird = Math.max(24, Math.floor(columns / 3));
	const totalRows = stdout?.rows ?? 24;
	const previewHeight = Math.max(5, totalRows - 12);
	const [scroll, setScroll] = useState(0);
	const [selectedRow, setSelectedRow] = useState(0);

	const entries = useMemo(() => parsedFile?.entries ?? [], [parsedFile?.entries]);
	useEffect(() => { setSelectedRow(0); setScroll(0); }, [parsedFile]);

	// Helper function to get status icon
	const getStatusIcon = useCallback((idx: number): string => {
		if (failed.has(idx)) return '✖';
		const status = entryCompletionStatus.get(idx);
		switch (status) {
			case 'backreferences-completed': return '✔';
			case 'backreferences-pending': return '⏳';
			case 'metaobject-created': return '◐';
			case 'failed': return '✖';
			default: return ' ';
		}
	}, [failed, entryCompletionStatus]);

	// Helper function to get status description
	const getStatusDescription = useCallback((idx: number): string => {
		if (failed.has(idx)) return 'Failed';
		const status = entryCompletionStatus.get(idx);
		switch (status) {
			case 'backreferences-completed': return 'Complete';
			case 'backreferences-pending': return 'Processing backreferences';
			case 'metaobject-created': return 'Metaobject created';
			case 'failed': return 'Failed';
			default: return 'Pending';
		}
	}, [failed, entryCompletionStatus]);

	// Helper function to get phase display name
	const getPhaseDisplayName = (phase: string): string => {
		switch (phase) {
			case 'pre-resolve': return 'Resolving References';
			case 'metaobjects': return 'Creating Metaobjects';
			case 'backreferences': return 'Setting Backreferences';
			default: return phase;
		}
	};

	// Helper function to get pre-resolve phase display name
	const getPreResolveDisplayName = (preResolvePhase: string): string => {
		switch (preResolvePhase) {
			case 'collecting': return 'Collecting references';
			case 'resolving-products': return 'Resolving products';
			case 'resolving-collections': return 'Resolving collections';
			case 'resolving-pages': return 'Resolving pages';
			case 'resolving-metaobjects': return 'Resolving metaobjects';
			case 'resolving-variants': return 'Resolving variants';
			case 'complete': return 'Complete';
			default: return preResolvePhase;
		}
	};

	// Table with status column (invisible header)
	const tableColumns: Column[] = useMemo(() => ([
		{ label: '', width: 2 },
		{ label: 'Type', width: 24 },
		{ label: 'Handle', width: 32 },
	]), []);
	const tableRowsAll: string[][] = useMemo(() => {
		return entries.map((e, idx) => {
			const status = getStatusIcon(idx);
			return [status, e.type ?? 'unknown', e.handle ?? ''];
		});
	}, [entries, getStatusIcon]);
	const tableSlice = tableRowsAll.slice(scroll, scroll + previewHeight);
	const maxJsonScroll = Math.max(0, lines.length - previewHeight);

	// Keep selected row within viewport
	useEffect(() => {
		if (selectedRow < scroll) setScroll(selectedRow);
		else if (selectedRow >= scroll + previewHeight) setScroll(selectedRow - previewHeight + 1);
	}, [selectedRow, scroll, previewHeight]);

	// Calculate completion stats
	const completionStats = useMemo(() => {
		const total = entries.length;
		let completed = 0;
		let pending = 0;
		let processing = 0;
		let failed = 0;
		
		for (let i = 0; i < total; i++) {
			const status = entryCompletionStatus.get(i);
			switch (status) {
				case 'backreferences-completed': completed++; break;
				case 'backreferences-pending': processing++; break;
				case 'metaobject-created': processing++; break;
				case 'failed': failed++; break;
				default: pending++; break;
			}
		}
		
		return { total, completed, pending, processing, failed };
	}, [entries.length, entryCompletionStatus]);

	// Keyboard handling per step
	useInput((input, key) => {
		// Global back to Home
		if (key.escape) {
			if (step === 1) { navigate('home'); return; }
		}

		if (step === 1) {
			if (key.upArrow) { setListIndex(i => Math.max(0, i - 1)); return; }
			if (key.downArrow) { setListIndex(i => Math.min(files.length - 1, i + 1)); return; }
			if (key.return && files[listIndex]) {
				selectFile(files[listIndex]);
				setStep(2);
				return;
			}
		}

		if (step === 2) {
			// Toggle view (always available)
			if (input?.toLowerCase() === 'v') { setViewMode(m => m === 'table' ? 'json' : 'table'); return; }
			
			// Import operations - only when not running
			if (!isRunning) {
				// Toggle skip on error
				if ((key.meta || key.ctrl) && input?.toLowerCase() === 's') { toggleSkipOnError(); return; }
				// Full import: Cmd+G (prefer meta to avoid ctrl+g clash with navbar)
				if ((key.meta || key.ctrl) && input?.toLowerCase() === 'g' && parsedFile) { confirmImport(); return; }
				// Back to file selection: Cmd/Ctrl+X
				if ((key.meta || key.ctrl) && input?.toLowerCase() === 'x') { setStep(1); return; }
				// Full import: Cmd/Ctrl+Enter (be lenient about Enter detection)
				const isEnter = key.return || input === '\r' || input === '\n';
				if (parsedFile && (key.meta || key.ctrl) && isEnter) { confirmImport(); return; }
				// Single entry import: plain Enter
				if (parsedFile && isEnter && !(key.meta || key.ctrl)) {
					importOne(selectedRow);
					return;
				}
			}
			
			// Navigation - always available (even during import)
			if (viewMode === 'json') {
				if (key.downArrow) setScroll(s => Math.min(s + 1, maxJsonScroll));
				if (key.upArrow) setScroll(s => Math.max(0, s - 1));
				if (key.pageDown) setScroll(s => Math.min(s + previewHeight, maxJsonScroll));
				if (key.pageUp) setScroll(s => Math.max(0, s - previewHeight));
			} else {
				if (key.downArrow) setSelectedRow(i => Math.min(entries.length - 1, i + 1));
				if (key.upArrow) setSelectedRow(i => Math.max(0, i - 1));
				if (key.pageDown) setSelectedRow(i => Math.min(entries.length - 1, i + previewHeight));
				if (key.pageUp) setSelectedRow(i => Math.max(0, i - previewHeight));
			}
		}
	});

	const selectColumns: Column[] = [
		{ label: 'File', width: 36 },
		{ label: 'Type', width: 10 },
		{ label: 'Environment', width: 14 },
		{ label: 'Created', width: 20 },
		{ label: 'Types', width: 24 }
	];
	const selectRows: string[][] = files.map(f => [
		f.name,
		f.type,
		f.environment ?? 'unknown',
		new Date(f.createdMs).toLocaleString(),
		(f.typesPreview ?? []).join(', ')
	]);

	if (step === 1) {
		return (
			<Box flexDirection="column">
				<WizardHeader title="Import" step={1} total={2} />
				<Panel title="Select a file to import">
					{files.length === 0 ? (
						<Text dimColor>No files in outputs</Text>
					) : (
						<Box flexDirection="column">
							<Table columns={selectColumns} rows={selectRows} activeIndex={listIndex} />
							<Text dimColor>↑/↓ select • Enter to preview • Esc to go back</Text>
						</Box>
					)}
				</Panel>
			</Box>
		);
	}

	// Step 2: 3-column responsive layout
	const header = selected ? `${selected.name} (${selected.type}) — ${new Date(selected.createdMs).toLocaleString()}` : 'No file selected';
	const selectedEntry = entries[selectedRow];
	
	return (
		<Box flexDirection="row" justifyContent="space-between">
			<Box width={widthThird} flexDirection="column" marginRight={1}>
				<WizardHeader title="Import" step={2} total={2} />
				<Text>File: {header}</Text>
				<Text>Environment: {parsedFile?.environment ?? selected?.environment ?? 'unknown'}</Text>
				<Text>Entries: {stats?.total ?? parsedFile?.count ?? 'n/a'}</Text>
				<Box marginTop={1} flexDirection="column">
					<Text>By type:</Text>
					{stats ? (
						Object.entries(stats.byType).map(([t, c]) => (
							<Text key={t}>{t}: {c}</Text>
						))
					) : (
						<Text dimColor>Unavailable</Text>
					)}
				</Box>
				<Box marginTop={1} flexDirection="column">
					<Text>Progress:</Text>
					<Text>✔ Complete: {completionStats.completed}</Text>
					<Text>⏳ Processing: {completionStats.processing}</Text>
					<Text>○ Pending: {completionStats.pending}</Text>
					<Text>✖ Failed: {completionStats.failed}</Text>
					{isRunning && progress?.phase && (
						<Box marginTop={1}>
							<Text color="cyan">
								🔄 Current: {getPhaseDisplayName(progress.phase)}
								{progress.phase === 'pre-resolve' && progress.preResolvePhase !== 'complete' && 
									` (${getPreResolveDisplayName(progress.preResolvePhase || '')})`}
							</Text>
						</Box>
					)}
				</Box>
				<Box marginTop={1} flexDirection="column">
					<Text>Hotkeys</Text>
					<Text dimColor>↑/↓: navigate entries</Text>
					<Text dimColor>v: toggle view</Text>
					{!isRunning ? (
						<>
							<Text dimColor>Enter: import selected</Text>
							<Text dimColor>Cmd/Ctrl+G: import all</Text>
							<Text dimColor>Cmd/Ctrl+S: skip on error: {skipOnError ? 'ON' : 'OFF'}</Text>
							<Text dimColor>Cmd/Ctrl+X: back</Text>
						</>
					) : (
						<Text dimColor color="yellow">Import running - navigation only</Text>
					)}
				</Box>
			</Box>
			<Box width={widthThird} flexDirection="column" marginX={1}>
				<Panel title="Entries">
					{viewMode === 'table' ? (
						<>
							<Table columns={tableColumns} rows={tableSlice} activeIndex={selectedRow - scroll} />
							<Text dimColor>Rows {Math.min(scroll + 1, tableRowsAll.length)}-{Math.min(scroll + previewHeight, tableRowsAll.length)} of {tableRowsAll.length}</Text>
						</>
					) : (
						<>
							{lines.slice(scroll, scroll + previewHeight).map((l, i) => (
								<Text key={i}>{l}</Text>
							))}
							<Text dimColor>
								Lines {Math.min(scroll + 1, lines.length)}-{Math.min(scroll + previewHeight, lines.length)} of {lines.length}
							</Text>
						</>
					)}
				</Panel>
			</Box>
			<Box width={widthThird} flexDirection="column" marginLeft={1}>
				<Panel title="Preview">
					{selectedEntry ? (
						<>
							<Text>{selectedEntry.type}/{selectedEntry.handle}</Text>
							<Text dimColor>Status: {getStatusDescription(selectedRow)}</Text>
							<Box marginTop={1} flexDirection="column">
								{entryCompletionStatus.get(selectedRow) === 'backreferences-completed' ? (
									<Text color="green">✔ Entry fully imported</Text>
								) : entryCompletionStatus.get(selectedRow) === 'backreferences-pending' ? (
									<Text color="yellow">⏳ Processing backreferences...</Text>
								) : entryCompletionStatus.get(selectedRow) === 'metaobject-created' ? (
									<Text color="blue">◐ Metaobject created, backreferences pending</Text>
								) : failed.has(selectedRow) ? (
									<Text color="red">✖ Failed</Text>
								) : isRunning ? (
									<Text dimColor>⏸ Waiting in queue...</Text>
								) : (
									<Text dimColor>Ready. Enter to import this entry.</Text>
								)}
								{failed.has(selectedRow) ? <Text color="red">Last error: {failed.get(selectedRow)}</Text> : null}
								{isRunning && progress?.current && progress.current === selectedEntry ? (
									<Text color="cyan">🔄 Currently processing this entry</Text>
								) : null}
								{!isRunning && entryCompletionStatus.get(selectedRow) !== 'backreferences-completed' && !failed.has(selectedRow) ? (
									<Text dimColor>Press Enter to import this entry</Text>
								) : null}
							</Box>
						</>
					) : (
						<Text dimColor>No entry selected</Text>
					)}
				</Panel>
				<Panel title="Current import status" >
					{progress ? (
						<Box flexDirection="column">
							{progress.current ? (
								<Text dimColor>Processing: {progress.current.type}/{progress.current.handle}</Text>
							) : progress.phase === 'pre-resolve' ? (
								<Text dimColor>Pre-resolving handle references...</Text>
							) : null}
							{progress.phase && <Text dimColor>Phase: {getPhaseDisplayName(progress.phase)}</Text>}
							{progress.message ? <Text dimColor>{progress.message}</Text> : null}
							{progress.phase === 'pre-resolve' && progress.preResolvePhase && (
								<>
									<Text dimColor>Pre-resolve: {getPreResolveDisplayName(progress.preResolvePhase)}</Text>
									{progress.preResolveCurrentType && <Text dimColor>Type: {progress.preResolveCurrentType}</Text>}
									{progress.preResolveTotal && progress.preResolveTotal > 0 && (
										<Text dimColor>Progress: {progress.preResolveProcessed ?? 0}/{progress.preResolveTotal}</Text>
									)}
									{progress.preResolveApiCalls !== undefined && (
										<Text dimColor>API calls: {progress.preResolveApiCalls}</Text>
									)}
									{progress.preResolveResolved !== undefined && progress.preResolveFailed !== undefined && (
										<Text dimColor>Resolved: {progress.preResolveResolved}, Failed: {progress.preResolveFailed}</Text>
									)}
								</>
							)}
							{progress.phase === 'backreferences' && progress.backReferencesTotal ? (
								<Text dimColor>Backreferences: {progress.backReferencesProcessed ?? 0}/{progress.backReferencesTotal}</Text>
							) : null}
							{progress.error ? (
								<Box marginTop={1}>
									<Text color="red">⚠ Error: {progress.error}</Text>
								</Box>
							) : null}
						</Box>
					) : (
						<Text dimColor>Idle</Text>
					)}
				</Panel>
			</Box>
		</Box>
	);
} 