import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useEnvironment } from '@context/EnvironmentContext';
import { listOutputFiles } from '@utils/outputs';
import type { OutputFile } from '@utils/outputs';
import { useFocusRegion } from '@context/FocusContext';
import { useNavigation } from '@context/NavigationContext';
import { useImport } from '@context/ImportContext';

function envFileToName(fileName: string): string {
	if (fileName.startsWith('.env.')) return fileName.slice(5);
	if (fileName === '.env') return 'default';
	return fileName;
}

export function Home() {
	useFocusRegion('page:home', true);
	const { availableEnvs } = useEnvironment();
	const envNames = useMemo(() => availableEnvs.map(e => envFileToName(e.name)), [availableEnvs]);
	const [files, setFiles] = useState<OutputFile[]>([]);
	const [activeIndex, setActiveIndex] = useState<number>(0);
	const { navigate } = useNavigation();
	const { selectFile } = useImport();

	useEffect(() => {
		const cwd = process.cwd();
		const list = listOutputFiles(cwd, envNames);
		setFiles(list);
		setActiveIndex(0);
	}, [envNames]);

	useInput((input, key) => {
		if (key.downArrow) setActiveIndex(i => Math.min(i + 1, files.length - 1));
		if (key.upArrow) setActiveIndex(i => Math.max(i - 1, 0));
		if (key.return && files[activeIndex]) {
			selectFile(files[activeIndex]);
			navigate('import');
		}
	});

	const colName = 36;
	const colType = 10;
	const colEnv = 14;
	const colDate = 20;
	const colTypesPreview = 24;

	function pad(text: string, width: number): string {
		if (text.length >= width) return text.slice(0, width - 1) + '…';
		return text + ' '.repeat(width - text.length);
	}

	function joinTypes(types?: string[]): string {
		if (!types || types.length === 0) return '';
		return types.join(', ');
	}

	return (
		<Box flexDirection="column">
			<Text color="green">Home</Text>
			{files.length === 0 ? (
				<Text dimColor>No files in outputs</Text>
			) : (
				<Box flexDirection="column">
					<Text>
						{pad('File', colName)}{pad('Type', colType)}{pad('Environment', colEnv)}{pad('Created', colDate)}{pad('Types', colTypesPreview)}
					</Text>
					{files.map((f, idx) => (
						<Text key={f.path} color={idx === activeIndex ? 'cyan' : undefined}>
							{pad(f.name, colName)}{pad(f.type, colType)}{pad(f.environment ?? 'unknown', colEnv)}{pad(new Date(f.createdMs).toLocaleString(), colDate)}{pad(joinTypes(f.typesPreview), colTypesPreview)}
						</Text>
					))}
				</Box>
			)}
			<Text dimColor>{'\u2190'} Press Enter to import</Text>
		</Box>
	);
} 