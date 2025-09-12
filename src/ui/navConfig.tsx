import React from 'react';
import { Home } from '@ui/Home';

export type NavKey = 'home';

export type PageConfig<K extends string = string> = {
	key: K;
	title: string;
	hotkey?: string; // single character hotkey
	component: React.ComponentType<unknown>;
};

export const pages: PageConfig<NavKey>[] = [
	{ key: 'home', title: 'Home', hotkey: 'h', component: Home }
]; 