import React, { useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { useEnvironment, EnvironmentFile } from '@context/EnvironmentContext';
import { NewEnvForm } from '@ui/setup/NewEnvForm';

export function EnvSetup() {
	const { availableEnvs, selectEnv, refreshEnvs } = useEnvironment();
	const [mode, setMode] = useState<'select' | 'create'>('select');

	type Item = { label: string; value: { type: 'env'; env: EnvironmentFile } | { type: 'create' }; key?: string };

	const items: Item[] = useMemo(() => {
		const base = availableEnvs.map(env => ({ label: env.name, value: { type: 'env', env } as const, key: env.path }));
		return [
			...base,
			{ label: '+ Create new environment', value: { type: 'create' }, key: 'create' }
		];
	}, [availableEnvs]);

	if (mode === 'create') {
		return (
			<Box flexDirection="column">
				<Text color="cyan">Create new environment</Text>
				<NewEnvForm onCreated={(env) => { refreshEnvs(); selectEnv(env); setMode('select'); }} onCancel={() => setMode('select')} />
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Text color="cyan">Select environment file</Text>
			{availableEnvs.length === 0 ? (
				<Box flexDirection="column">
					<Text color="yellow">No .env files found in project root.</Text>
					<Text>Select {"\""}+ Create new environment{"\""} to get started.</Text>
				</Box>
			) : null}
			<SelectInput
				items={items}
				onSelect={(item) => {
					if (item.value.type === 'create') setMode('create');
					else selectEnv(item.value.env);
				}}
			/>
		</Box>
	);
} 