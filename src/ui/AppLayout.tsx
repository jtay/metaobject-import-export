import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { pages, PageConfig } from '@ui/navConfig';
import { useGlobalHotkeysEnabled, useFocusContext } from '@context/FocusContext';
import { useEnvironment } from '@context/EnvironmentContext';
import { useNavigation } from '@context/NavigationContext';

export type AppLayoutProps = {
	pages?: PageConfig[];
	initialKey?: string;
	onNavigate?: (key: string) => void;
};

export function AppLayout({ pages: pagesProp, initialKey, onNavigate }: AppLayoutProps) {
	const availablePages = useMemo(() => pagesProp ?? pages, [pagesProp]);
	const [activeKey, setActiveKey] = useState<string>(initialKey ?? availablePages[0]?.key);
	const [navFocused, setNavFocused] = useState<boolean>(false);
	const [navHoverIndex, setNavHoverIndex] = useState<number>(0);
	const globalHotkeysEnabled = useGlobalHotkeysEnabled();
	const { request } = useNavigation();
	const { activeRegionId, clearFocus } = useFocusContext();

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

	useEffect(() => {
		if (!request) return;
		const target = availablePages.find(p => p.key === request.key)?.key;
		if (target) handleNavigate(target);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [request?.seq]);

	useInput((input, key) => {
		// Cmd+<hotkey> jumps directly without focusing navbar
		if (key.meta && input && /^[a-z0-9]$/i.test(input)) {
			const target = hotkeyToKey[input.toLowerCase()];
			if (target) {
				handleNavigate(target);
				return;
			}
		}

		// Esc always returns focus to navbar
		if (key.escape) {
			setNavFocused(true);
			clearFocus();
			return;
		}

		// Ctrl+G also returns focus to navbar
		if (key.ctrl && input?.toLowerCase() === 'g') {
			setNavFocused(true);
			clearFocus();
			return;
		}

		if (navFocused) {
			if (key.leftArrow) {
				setNavHoverIndex((i) => (i - 1 + availablePages.length) % availablePages.length);
				return;
			}
			if (key.rightArrow) {
				setNavHoverIndex((i) => (i + 1) % availablePages.length);
				return;
			}
			if (key.return || input === '\t') {
				const nextKey = availablePages[navHoverIndex]?.key;
				if (nextKey) {
					handleNavigate(nextKey);
					setNavFocused(false);
				}
				return;
			}
			// Also allow hotkeys while navbar focused
			if (input && /^[a-z0-9]$/i.test(input)) {
				const target = hotkeyToKey[input.toLowerCase()];
				if (target) {
					handleNavigate(target);
					setNavFocused(false);
				}
				return;
			}
			return;
		}

		// When page is focused, ignore navbar hotkeys unless globalHotkeysEnabled
		if (!globalHotkeysEnabled) return;

		// Tab cycles pages when not in a text input context
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

	const contentBorderColor = !navFocused && activeRegionId ? 'green' : 'gray';
	const navBorderColor = navFocused ? 'green' : 'cyan';

	return (
		<Box width={columns} height={rows} flexDirection="column">
			<NavBar
				pages={availablePages}
				activeKey={activeKey}
				borderColor={navBorderColor}
				navFocused={navFocused}
				hoverIndex={navHoverIndex}
			/>
			<Box flexGrow={1} borderStyle="round" borderColor={contentBorderColor} paddingX={1} paddingY={0}>
				<ActiveComponent />
			</Box>
			<Box marginTop={0}>
				<Text dimColor>Focus: {navFocused ? 'navbar' : activeRegionId ? `page (${activeRegionId})` : 'navbar'} • Esc to navigate • Cmd+[h/i/e] jump</Text>
			</Box>
		</Box>
	);
}

function NavBar({ pages, activeKey, borderColor, navFocused, hoverIndex }: { pages: PageConfig[]; activeKey?: string; borderColor: string; navFocused: boolean; hoverIndex: number }) {
	const { selectedEnv } = useEnvironment();
	return (
		<Box height={3} paddingX={1} borderStyle="round" borderColor={borderColor} justifyContent="space-between">
			<Box>
				<Text color="cyan">Metaobject CLI</Text>
				{selectedEnv?.name ? (
					<Text color="gray"> - {selectedEnv.name}</Text>
				) : null}
			</Box>
			<Box>
				{pages.map((p, index) => {
					const isActive = p.key === activeKey;
					const isHover = index === hoverIndex && navFocused;
					const color = isHover ? 'yellow' : isActive ? 'green' : 'white';
					return (
						<Box key={p.key} marginLeft={2}>
							<Text color={color}>
								{p.title}
								{p.hotkey ? ` [${p.hotkey}]` : ''}
							</Text>
						</Box>
					);
				})}
			</Box>
			<Box>
				<Text dimColor>Esc to navigate</Text>
			</Box>
		</Box>
	);
} 