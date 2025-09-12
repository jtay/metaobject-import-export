import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { FocusTextInput } from '@ui/components/FocusTextInput';
import { useFocusRegion } from '@context/FocusContext';
import { useNavigation } from '@context/NavigationContext';
import { useEnvironment } from '@context/EnvironmentContext';
import { createShopifyClientFromEnv } from '@utils/shopify/env';
import { runExport, type ExportProgress } from '@utils/exporter';

export function Export() {
	useFocusRegion('page:export', true);
	const { selectedEnv } = useEnvironment();
	const { navigate } = useNavigation();

	const [types, setTypes] = useState<string[]>([]);
	const [newType, setNewType] = useState<string>('');
	const [retainIds, setRetainIds] = useState<boolean>(true);
	const [running, setRunning] = useState<boolean>(false);
	const [resultPath, setResultPath] = useState<string | undefined>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);
	const [focusIndex, setFocusIndex] = useState<number>(0); // 0: input, 1: list, 2: checkbox, 3: run
	const [listIndex, setListIndex] = useState<number>(0);
	const [progress, setProgress] = useState<ExportProgress | undefined>(undefined);

	const hasList = types.length > 0;
	const maxFocus = hasList ? 3 : 2;

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
		if (!running && key.escape) {
			navigate('home');
			return;
		}

		if (key.tab && !key.shift) {
			setFocusIndex(i => clampFocus(i + 1));
			return;
		}
		if (key.tab && key.shift) {
			setFocusIndex(i => clampFocus(i - 1));
			return;
		}

		if (focusIndex === 0) {
			if (key.return) {
				addType(newType);
				return;
			}
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
			if ((key.return || input?.toLowerCase() === 'r') && canRun) { void run(); return; }
		}

		// Allow Enter to run from anywhere if on last focusable
		if ((key.return || input?.toLowerCase() === 'r') && canRun && focusIndex === maxFocus) { void run(); return; }
	});

	async function run() {
		setRunning(true);
		setError(undefined);
		setProgress(undefined);
		setResultPath(undefined);
		try {
			const client = createShopifyClientFromEnv();
			const outPath = await runExport(client, {
				cwd: process.cwd(),
				environmentFileName: selectedEnv?.name ?? 'unknown',
				types,
				retainIds,
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

	return (
		<Box flexDirection="column">
			<Text color="green">Export</Text>
			<Box>
				<Text>Environment: {selectedEnv?.name ?? 'unknown'}</Text>
			</Box>

			<Box flexDirection="column" marginTop={1}>
				<Text>Metaobject types</Text>
				<Box>
					<Text color={focusIndex === 0 ? 'yellow' : 'gray'}>Add type:</Text>
					<Box marginLeft={1}>
						<FocusTextInput focus={focusIndex === 0} value={newType} onChange={setNewType} placeholder="article author banner" />
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
				<Text color={focusIndex === 2 ? 'yellow' : 'white'}>
					[{retainIds ? 'x' : ' '}] Retain original IDs
				</Text>
			</Box>

			<Box marginTop={1}>
				<Text dimColor>
					{running ? (progress ? `${progress.phase}: ${progress.message}${progress.count ? ` (${progress.count})` : ''}` : 'Exporting…') : types.length > 0 ? 'Enter to run • Tab/Shift+Tab to move • Esc to go back' : 'Add at least one type'}
				</Text>
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