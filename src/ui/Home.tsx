import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useEnvironment } from '@context/EnvironmentContext';
import { listOutputFiles } from '@utils/outputs';
import type { OutputFile } from '@utils/outputs';
import { useFocusRegion } from '@context/FocusContext';
import { useNavigation } from '@context/NavigationContext';
import { useImport } from '@context/ImportContext';
import { createShopifyClientFromEnv } from '@utils/shopify/env';
import { getShopInfo, type ShopInfo } from '@utils/shopify/shop';
import { Panel } from '@ui/components/Panel';
import { Table, type Column } from '@ui/components/Table';

function envFileToName(fileName: string): string {
	if (fileName.startsWith('.env.')) return fileName.slice(5);
	if (fileName === '.env') return 'default';
	return fileName;
}

export function Home() {
	useFocusRegion('page:home', true);
	const { availableEnvs, selectedEnv } = useEnvironment();
	const envNames = useMemo(() => availableEnvs.map(e => envFileToName(e.name)), [availableEnvs]);
	const [files, setFiles] = useState<OutputFile[]>([]);
	const [activeIndex, setActiveIndex] = useState<number>(0);
	const { navigate } = useNavigation();
	const { selectFile } = useImport();
	const [shop, setShop] = useState<ShopInfo | undefined>(undefined);
	const [shopError, setShopError] = useState<string | undefined>(undefined);

	useEffect(() => {
		const cwd = process.cwd();
		const list = listOutputFiles(cwd, envNames);
		setFiles(list);
		setActiveIndex(0);
	}, [envNames]);

	useEffect(() => {
		async function loadShop() {
			setShop(undefined);
			setShopError(undefined);
			try {
				const client = createShopifyClientFromEnv();
				const info = await getShopInfo(client);
				setShop(info);
			} catch (e) {
				setShopError(String(e));
			}
		}
		if (selectedEnv) void loadShop();
	}, [selectedEnv]);

	useInput((input, key) => {
		if (key.downArrow) setActiveIndex(i => Math.min(i + 1, files.length - 1));
		if (key.upArrow) setActiveIndex(i => Math.max(i - 1, 0));
		if (key.return && files[activeIndex]) {
			selectFile(files[activeIndex]);
			navigate('import');
		}
	});

	const columns: Column[] = [
		{ label: 'File', width: 36 },
		{ label: 'Type', width: 10 },
		{ label: 'Environment', width: 14 },
		{ label: 'Created', width: 20 },
		{ label: 'Types', width: 24 }
	];
	const rows: string[][] = files.map(f => [
		f.name,
		f.type,
		f.environment ?? 'unknown',
		new Date(f.createdMs).toLocaleString(),
		(f.typesPreview ?? []).join(', ')
	]);

	return (
		<Box flexDirection="column">
			<Text color="green">Home</Text>
			<Box marginTop={1} padding={1}>
				<Panel title="Connection" borderColor={selectedEnv ? 'green' : 'yellow'}>
					{selectedEnv ? (
						<Box flexDirection="column">
							<Text>Environment: {selectedEnv.name}</Text>
							{shop ? (
								<Text dimColor>Shop: {shop.name ?? 'unknown'} • {shop.myshopifyDomain ?? ''} • {shop.planName ?? ''}</Text>
							) : shopError ? (
								<Text color="red">Failed to fetch shop info: {shopError}</Text>
							) : (
								<Text dimColor>Fetching shop info…</Text>
							)}
						</Box>
					) : (
						<Text color="yellow">No environment selected. Go to Environments to select or create one.</Text>
					)}
				</Panel>
			</Box>
			<Box marginTop={1} padding={1}>
				<Panel title="Recent outputs">
					{files.length === 0 ? (
						<Text dimColor>No files in outputs</Text>
					) : (
						<Box flexDirection="column">
							<Table columns={columns} rows={rows} activeIndex={activeIndex} />
							<Text dimColor>{'\u2190'} Press Enter to import</Text>
						</Box>
					)}
				</Panel>
			</Box>
		</Box>
	);
} 