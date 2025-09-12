import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { pages, PageConfig } from '@ui/navConfig';
import { useGlobalHotkeysEnabled } from '@context/FocusContext';
import { useEnvironment } from '@context/EnvironmentContext';

export type AppLayoutProps = {
	pages?: PageConfig[];
	initialKey?: string;
	onNavigate?: (key: string) => void;
};

export function AppLayout({ pages: pagesProp, initialKey, onNavigate }: AppLayoutProps) {
	const availablePages = useMemo(() => pagesProp ?? pages, [pagesProp]);
	const [activeKey, setActiveKey] = useState<string>(initialKey ?? availablePages[0]?.key);
	const globalHotkeysEnabled = useGlobalHotkeysEnabled();

	const hotkeyToKey = useMemo(() => {
		const map: Record<string, string> = {};
		for (const p of availablePages) {
			if (p.hotkey) map[p.hotkey.toLowerCase()] = p.key;
		}
		return map;
	}, [availablePages]);

	useEffect(() => {
		if (!activeKey && availablePages[0]) setActiveKey(availablePages[0].key);
	}, [activeKey, availablePages]);

	useInput((input, key) => {
		if (!globalHotkeysEnabled) return;

		if (input === '\t') {
			const idx = availablePages.findIndex(p => p.key === activeKey);
			const nextIdx = (idx + 1) % availablePages.length;
			const nextKey = availablePages[nextIdx]?.key;
			if (nextKey) handleNavigate(nextKey);
			return;
		}

		if (input && /^[a-z0-9]$/i.test(input) && !key.shift && !key.ctrl && !key.meta) {
			const target = hotkeyToKey[input.toLowerCase()];
			if (target) handleNavigate(target);
		}
	});

	const { stdout } = useStdout();
	const columns = stdout?.columns ?? 80;
	const rows = (stdout?.rows ?? 24) - 6;

	const ActiveComponent = useMemo(() => {
		return availablePages.find(p => p.key === activeKey)?.component ?? (() => null);
	}, [availablePages, activeKey]);

	function handleNavigate(nextKey: string) {
		setActiveKey(nextKey);
		onNavigate?.(nextKey);
	}

	return (
		<Box width={columns} height={rows} flexDirection="column">
			<NavBar pages={availablePages} activeKey={activeKey} />
			<Box flexGrow={1} borderStyle="round" borderColor="gray" paddingX={1} paddingY={0}>
				<ActiveComponent />
			</Box>
		</Box>
	);
}

function NavBar({ pages, activeKey }: { pages: PageConfig[]; activeKey?: string }) {
	const { selectedEnv } = useEnvironment();
	return (
		<Box height={3} paddingX={1} borderStyle="round" borderColor="cyan">
			<Box>
				<Text color="cyan">Metaobject CLI</Text>
				{selectedEnv?.name ? (
					<Text color="gray"> — {selectedEnv.name}</Text>
				) : null}
			</Box>
			<Box marginLeft={2}>
				{pages.map((p, index) => (
					<Box key={p.key} marginRight={2}>
						<Text color={p.key === activeKey ? 'green' : 'white'}>
							{p.title}
							{p.hotkey ? ` [${p.hotkey}]` : ''}
							{index < pages.length ? '' : ''}
						</Text>
					</Box>
				))}
			</Box>
			<Box marginLeft={2}>
				<Text dimColor>Navigate: Tab, Hotkeys: [letter]</Text>
			</Box>
		</Box>
	);
} 