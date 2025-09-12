import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { FocusTextInput } from '@ui/components/FocusTextInput';
import { useFocusRegion } from '@context/FocusContext';
import { useNavigation } from '@context/NavigationContext';
import { useEnvironment } from '@context/EnvironmentContext';
import { createShopifyClientFromEnv } from '@utils/shopify/env';
import { runExport, type ExportProgress } from '@utils/exporter';
import { WizardHeader } from '@ui/components/WizardHeader';
import { CheckboxRow } from '@ui/components/CheckboxRow';
import { ButtonRow } from '@ui/components/ButtonRow';

export function Export() {
	useFocusRegion('page:export', true);
	const { selectedEnv } = useEnvironment();
	const { navigate } = useNavigation();

	const [types, setTypes] = useState<string[]>([]);
	const [newType, setNewType] = useState<string>('');
	const [retainIds, setRetainIds] = useState<boolean>(true);
	const [includeBackRefs, setIncludeBackRefs] = useState<boolean>(false);
	const [running, setRunning] = useState<boolean>(false);
	const [resultPath, setResultPath] = useState<string | undefined>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);
	const [focusIndex, setFocusIndex] = useState<number>(0); // 0: input, 1: list, 2: retainIds, 3: includeBackRefs, 4: run
	const [listIndex, setListIndex] = useState<number>(0);
	const [progress, setProgress] = useState<ExportProgress | undefined>(undefined);
	const [step, setStep] = useState<number>(1); // 1=Form, 2=Run

	const hasList = types.length > 0;
	const maxFocus = hasList ? 4 : 3;

	const canRun = types.length > 0 && !running;

	function clampFocus(idx: number): number {
		if (!hasList && idx === 1) return 2;
		return Math.max(0, Math.min(idx, maxFocus));
	}

	function addType(value: string) {
		const t = value.trim();
		if (!t) return;
		setTypes(prev => (prev.includes(t) ? prev : [...prev, t]));
		setNewType('');
		if (!hasList) setListIndex(0);
	}

	function removeSelectedType() {
		if (!hasList) return;
		setTypes(prev => prev.filter((_, i) => i !== listIndex));
		setListIndex(i => Math.max(0, i - 1));
	}

	function editSelectedType() {
		if (!hasList) return;
		setNewType(types[listIndex] ?? '');
		setTypes(prev => prev.filter((_, i) => i !== listIndex));
		setFocusIndex(0);
	}

	useInput((input, key) => {
		if (step === 1) {
			if (!running && key.escape) { navigate('home'); return; }

			if (key.tab && !key.shift) { setFocusIndex(i => clampFocus(i + 1)); return; }
			if (key.tab && key.shift) { setFocusIndex(i => clampFocus(i - 1)); return; }

			if (focusIndex === 0) {
				if (key.return) { addType(newType); return; }
			}
			if (focusIndex === 1) {
				if (key.upArrow) { setListIndex(i => Math.max(0, i - 1)); return; }
				if (key.downArrow) { setListIndex(i => Math.min(types.length - 1, i + 1)); return; }
				if (input?.toLowerCase() === 'e') { editSelectedType(); return; }
				if (key.backspace || key.delete) { removeSelectedType(); return; }
			}
			if (focusIndex === 2) {
				if (key.return || input === ' ') { setRetainIds(v => !v); return; }
			}
			if (focusIndex === 3) {
				if (key.return || input === ' ') { setIncludeBackRefs(v => !v); return; }
			}
			if (focusIndex === 4) {
				if ((key.return || input?.toLowerCase() === 'r') && canRun) { void run(); return; }
			}
			if ((key.return || input?.toLowerCase() === 'r') && canRun && focusIndex === maxFocus) { void run(); return; }
		} else {
			// Step 2 (Run)
			if (!running && key.escape) { setStep(1); return; }
		}
	});

	async function run() {
		setRunning(true);
		setError(undefined);
		setProgress(undefined);
		setResultPath(undefined);
		setStep(2);
		try {
			const client = createShopifyClientFromEnv();
			const outPath = await runExport(client, {
				cwd: process.cwd(),
				environmentFileName: selectedEnv?.name ?? 'unknown',
				types,
				retainIds,
				includeBackReferences: includeBackRefs,
				onProgress: setProgress
			});
			setResultPath(outPath);
		} catch (e) {
			setError(String(e));
		} finally {
			setRunning(false);
			setProgress(undefined);
		}
	}

	if (step === 1) {
		return (
			<Box flexDirection="column">
				<WizardHeader title="Export" step={1} total={2} />
				<Box>
					<Text>Environment: {selectedEnv?.name ?? 'unknown'}</Text>
				</Box>
				<Box flexDirection="column" marginTop={1}>
					<Text>Metaobject types</Text>
					<Box>
						<Text color={focusIndex === 0 ? 'yellow' : 'gray'}>Add type:</Text>
						<Box marginLeft={1}>
							<FocusTextInput focus={focusIndex === 0} value={newType} onChange={setNewType} placeholder="Supports $app: prefix" />
						</Box>
					</Box>
					{types.length > 0 ? (
						<Box flexDirection="column" marginTop={1}>
							{types.map((t, idx) => (
								<Box key={`${t}-${idx}`}>
									<Text color={focusIndex === 1 && listIndex === idx ? 'yellow' : 'white'}>
										{focusIndex === 1 && listIndex === idx ? '› ' : '  '}{t}
									</Text>
								</Box>
							))}
							<Text dimColor>↑/↓ select • e edit • ⌫/Del remove</Text>
						</Box>
					) : (
						<Text dimColor>No types added yet</Text>
					)}
				</Box>

				<Box marginTop={1}>
					<CheckboxRow label="Retain original IDs" checked={retainIds} focused={focusIndex === 2} />
				</Box>

				<Box marginTop={1}>
					<CheckboxRow label="Include metaobject entry parent references" checked={includeBackRefs} focused={focusIndex === 3} />
				</Box>

				<Box marginTop={1}>
					<Text dimColor>{canRun ? 'Enter to run • Tab/Shift+Tab to move • Esc to go back' : 'Add at least one type'}</Text>
				</Box>
				<Box marginTop={1}>
					<ButtonRow label="Run export" focused={focusIndex === 4} />
				</Box>
				{error ? (
					<Box marginTop={1}><Text color="red">{error}</Text></Box>
				) : null}
				{resultPath ? (
					<Box marginTop={1}><Text color="cyan">Wrote: {resultPath}</Text></Box>
				) : null}
			</Box>
		);
	}

	// Step 2: Run progress
	return (
		<Box flexDirection="column">
			<WizardHeader title="Export" step={2} total={2} />
			<Box>
				<Text>Environment: {selectedEnv?.name ?? 'unknown'}</Text>
			</Box>
			<Box marginTop={1} flexDirection="column">
				<Text>Selected types:</Text>
				{types.length > 0 ? types.map((t, idx) => <Text key={`${t}-${idx}`}>- {t}</Text>) : <Text dimColor>None</Text>}
			</Box>
			<Box marginTop={1}>
				<Text dimColor>{running ? (progress ? `${progress.phase}: ${progress.message}${progress.count ? ` (${progress.count})` : ''}` : 'Exporting…') : (resultPath ? 'Done. Esc to go back' : 'Ready')}</Text>
			</Box>
			{error ? (
				<Box marginTop={1}><Text color="red">{error}</Text></Box>
			) : null}
			{resultPath ? (
				<Box marginTop={1}><Text color="cyan">Wrote: {resultPath}</Text></Box>
			) : null}
		</Box>
	);
} 