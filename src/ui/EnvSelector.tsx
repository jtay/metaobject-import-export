import React, { useMemo, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { useEnvironment, EnvironmentFile } from '@context/EnvironmentContext';

type SelectItem = { label: string; value: EnvironmentFile; key?: string };

export function EnvSelector() {
	const { availableEnvs, selectEnv, refreshEnvs } = useEnvironment();

	useEffect(() => { refreshEnvs(); }, [refreshEnvs]);

	const items: SelectItem[] = useMemo(() => {
		return availableEnvs.map((env) => ({ label: env.name, value: env }));
	}, [availableEnvs]);

	if (availableEnvs.length === 0) {
		return (
			<Box flexDirection="column">
				<Text color="yellow">No .env files found in project root.</Text>
				<Text>Create one (e.g. .env.development) and restart.</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Text color="cyan">Select environment file</Text>
			<SelectInput
				items={items}
				onSelect={(item: SelectItem) => selectEnv(item.value)}
			/>
		</Box>
	);
} 