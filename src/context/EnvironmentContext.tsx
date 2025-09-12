import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import dotenv from 'dotenv';
import { listEnvFiles } from '@utils/envFiles';

export type EnvironmentFile = {
	name: string;
	path: string;
};

export type EnvironmentContextValue = {
	availableEnvs: EnvironmentFile[];
	selectedEnv?: EnvironmentFile;
	selectEnv: (env: EnvironmentFile) => void;
	locked: boolean;
};

const EnvironmentContext = createContext<EnvironmentContextValue | undefined>(undefined);

export function EnvironmentProvider({ children }: { children: React.ReactNode }) {
	const [availableEnvs, setAvailableEnvs] = useState<EnvironmentFile[]>([]);
	const [selectedEnv, setSelectedEnv] = useState<EnvironmentFile | undefined>(undefined);
	const [locked, setLocked] = useState<boolean>(false);

	useEffect(() => {
		const cwd = process.cwd();
		const envs = listEnvFiles(cwd);
		setAvailableEnvs(envs);
	}, []);

	useEffect(() => {
		if (!selectedEnv) return;
		const envConfig = dotenv.config({ path: selectedEnv.path });
		if (envConfig.error) {
			// eslint-disable-next-line no-console
			console.error(`Failed to load env from ${selectedEnv.path}:`, envConfig.error);
		}
	}, [selectedEnv]);

	const selectEnv = (env: EnvironmentFile) => {
		if (locked) return; // ignore attempts after lock
		setSelectedEnv(env);
		setLocked(true);
	};

	const value = useMemo<EnvironmentContextValue>(() => ({
		availableEnvs,
		selectedEnv,
		selectEnv,
		locked
	}), [availableEnvs, selectedEnv, locked]);

	return (
		<EnvironmentContext.Provider value={value}>
			{children}
		</EnvironmentContext.Provider>
	);
}

export function useEnvironment(): EnvironmentContextValue {
	const ctx = useContext(EnvironmentContext);
	if (!ctx) {
		throw new Error('useEnvironment must be used within EnvironmentProvider');
	}
	return ctx;
} 