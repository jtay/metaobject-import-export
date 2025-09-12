import React from 'react';
import { Home } from '@ui/Home';
import { Import } from '@ui/Import';
import { Export } from '@ui/Export';
import { EnvSetup } from '@ui/setup/EnvSetup';

export type NavKey = 'home' | 'import' | 'export' | 'env';

export type PageConfig<K extends string = string> = {
	key: K;
	title: string;
	hotkey?: string; // single character hotkey
	component: React.ComponentType<unknown>;
};

export const pages: PageConfig<NavKey>[] = [
	{ key: 'home', title: 'Home', hotkey: 'h', component: Home },
	{ key: 'import', title: 'Import', hotkey: 'i', component: Import },
	{ key: 'export', title: 'Export', hotkey: 'e', component: Export },
	{ key: 'env', title: 'Environments', hotkey: 'n', component: EnvSetup }
]; 