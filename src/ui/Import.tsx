import React, { useMemo, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { useImport } from '@context/ImportContext';
import { useFocusRegion } from '@context/FocusContext';
import { useNavigation } from '@context/NavigationContext';

export function Import() {
	useFocusRegion('page:import', true);
	const { selected, contentText, parsedFile, stats, confirmImport, isRunning, progress } = useImport();
	const { navigate } = useNavigation();

	const pretty = useMemo(() => {
		if (!contentText) return '';
		try {
			const parsed = JSON.parse(contentText);
			return JSON.stringify(parsed, null, 2);
		} catch {
			return contentText;
		}
	}, [contentText]);

	const lines = useMemo(() => pretty.split(/\r?\n/), [pretty]);
	const [scroll, setScroll] = useState(0);
	const { stdout } = useStdout();
	const totalRows = stdout?.rows ?? 24;
	const previewHeight = Math.max(5, totalRows - 10);

	useInput((input, key) => {
		if (key.downArrow) setScroll(s => Math.min(s + 1, Math.max(0, lines.length - previewHeight)));
		if (key.upArrow) setScroll(s => Math.max(0, s - 1));
		if (key.pageDown) setScroll(s => Math.min(s + previewHeight, Math.max(0, lines.length - previewHeight)));
		if (key.pageUp) setScroll(s => Math.max(0, s - previewHeight));
		if (key.return && !isRunning) confirmImport();
		if (key.escape || key.leftArrow || input?.toLowerCase() === 'b' || input?.toLowerCase() === 'h' || input?.toLowerCase() === 'q') navigate('home');
	});

	if (!selected) {
		return (
			<Box flexDirection="column">
				<Text color="yellow">No file selected.</Text>
				<Text dimColor>Go back to Home and choose a file.</Text>
			</Box>
		);
	}

	const header = `${selected.name} (${selected.type}) — ${new Date(selected.createdMs).toLocaleString()}`;
	const currentLabel = progress?.current ? `${progress.current.type}/${progress.current.handle}` : undefined;

	return (
		<Box flexDirection="row" justifyContent="space-between">
			<Box width={42} flexDirection="column" marginRight={2}>
				<Text color="green">Import</Text>
				<Text>File: {header}</Text>
				<Text>Environment: {parsedFile?.environment ?? selected.environment ?? 'unknown'}</Text>
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
					<Text dimColor>{isRunning ? `Importing… ${progress ? `${progress.index + 1}/${progress.total}` : ''}${currentLabel ? ` • ${currentLabel}` : ''}` : 'Enter to run import • Esc/Left/B/H/Q to go back'}</Text>
				</Box>
				{progress?.message ? (
					<Box marginTop={1}><Text dimColor>{progress.message}</Text></Box>
				) : null}
			</Box>
			<Box flexGrow={1} borderStyle="round" borderColor="gray" paddingX={1} paddingY={0} flexDirection="column">
				<Text color="cyan">Preview</Text>
				{lines.slice(scroll, scroll + previewHeight).map((l, i) => (
					<Text key={i}>
						{l}
					</Text>
				))}
				<Text dimColor>
					Lines {scroll + 1}-{Math.min(scroll + previewHeight, lines.length)} of {lines.length}
				</Text>
			</Box>
		</Box>
	);
} 