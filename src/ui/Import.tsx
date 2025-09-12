import React, { useEffect, useMemo, useState } from 'react';
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
	const { selected, contentText, parsedFile, stats, confirmImport, isRunning, progress, selectFile, clear } = useImport();
	const { navigate } = useNavigation();
	const { availableEnvs } = useEnvironment();

	// Steps: 1=Select, 2=Preview, 3=Run
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

	// Step 2 state: preview
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
	const totalRows = stdout?.rows ?? 24;
	const previewHeight = Math.max(5, totalRows - 12);
	const [scroll, setScroll] = useState(0);

	const tableColumns: Column[] = useMemo(() => ([
		{ label: 'Type', width: 28 },
		{ label: 'Handle', width: 40 },
		{ label: 'Fields', width: 32 }
	]), []);
	const tableRowsAll: string[][] = useMemo(() => {
		const entries = parsedFile?.entries ?? [];
		return entries.map(e => {
			const keys = Object.keys(e.fields ?? {}).slice(0, 6).join(', ');
			return [e.type ?? 'unknown', e.handle ?? '', keys];
		});
	}, [parsedFile]);
	const tableSlice = tableRowsAll.slice(scroll, scroll + previewHeight);
	const maxTableScroll = Math.max(0, tableRowsAll.length - previewHeight);
	const maxJsonScroll = Math.max(0, lines.length - previewHeight);

	// Keyboard handling per step
	useInput((input, key) => {
		// Global back to Home
		if (key.escape) {
			if (step === 1) { navigate('home'); return; }
			if (step === 2) { setStep(1); return; }
			if (step === 3 && !isRunning) { setStep(1); clear(); return; }
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
			// Toggle view
			if (input?.toLowerCase() === 'v') { setViewMode(m => m === 'table' ? 'json' : 'table'); return; }
			if (viewMode === 'json') {
				if (key.downArrow) setScroll(s => Math.min(s + 1, maxJsonScroll));
				if (key.upArrow) setScroll(s => Math.max(0, s - 1));
				if (key.pageDown) setScroll(s => Math.min(s + previewHeight, maxJsonScroll));
				if (key.pageUp) setScroll(s => Math.max(0, s - previewHeight));
			} else {
				if (key.downArrow) setScroll(s => Math.min(s + 1, maxTableScroll));
				if (key.upArrow) setScroll(s => Math.max(0, s - 1));
				if (key.pageDown) setScroll(s => Math.min(s + previewHeight, maxTableScroll));
				if (key.pageUp) setScroll(s => Math.max(0, s - previewHeight));
			}
			if (key.return && !isRunning && parsedFile) {
				setStep(3);
				confirmImport();
				return;
			}
		}

		if (step === 3) {
			// No-op; allow Escape handled above when not running
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
				<WizardHeader title="Import" step={1} total={3} />
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

	if (step === 2) {
		const header = selected ? `${selected.name} (${selected.type}) — ${new Date(selected.createdMs).toLocaleString()}` : 'No file selected';
		return (
			<Box flexDirection="row" justifyContent="space-between">
				<Box width={36} flexDirection="column" marginRight={2}>
					<WizardHeader title="Import" step={2} total={3} />
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
					<Box marginTop={1}>
						<Text dimColor>Enter to run import • v toggle view • Esc to go back</Text>
					</Box>
				</Box>
				<Box flexGrow={1} flexDirection="column">
					{viewMode === 'table' ? (
						<Panel title="Preview (Table)">
							<Table columns={tableColumns} rows={tableSlice} />
							<Text dimColor>Rows {Math.min(scroll + 1, tableRowsAll.length)}-{Math.min(scroll + previewHeight, tableRowsAll.length)} of {tableRowsAll.length}</Text>
						</Panel>
					) : (
						<Panel title="Preview (JSON)">
							{lines.slice(scroll, scroll + previewHeight).map((l, i) => (
								<Text key={i}>{l}</Text>
							))}
							<Text dimColor>
								Lines {Math.min(scroll + 1, lines.length)}-{Math.min(scroll + previewHeight, lines.length)} of {lines.length}
							</Text>
						</Panel>
					)}
				</Box>
			</Box>
		);
	}

	// Step 3: Run
	const currentLabel = progress?.current ? `${progress.current.type}/${progress.current.handle}` : undefined;
	return (
		<Box flexDirection="row" justifyContent="space-between">
			<Box width={36} flexDirection="column" marginRight={2}>
				<WizardHeader title="Import" step={3} total={3} />
				<Text>Entries: {parsedFile?.count ?? stats?.total ?? 'n/a'}</Text>
				<Box marginTop={1}>
					<Text dimColor>{isRunning ? `Importing… ${progress ? `${progress.index + 1}/${progress.total}` : ''}${currentLabel ? ` • ${currentLabel}` : ''}` : 'Done. Esc to select another or Cmd+h for Home'}</Text>
				</Box>
				{progress?.message ? (
					<Box marginTop={1}><Text dimColor>{progress.message}</Text></Box>
				) : null}
			</Box>
			<Box flexGrow={1} flexDirection="column">
				<Panel title="Progress">
					{progress?.message ? <Text dimColor>{progress.message}</Text> : <Text dimColor>Starting…</Text>}
				</Panel>
			</Box>
		</Box>
	);
} 