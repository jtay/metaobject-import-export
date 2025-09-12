import React from 'react';
import { Box, Text } from 'ink';
import { useEnvironment } from '@context/EnvironmentContext';

export function Home() {
	const { selectedEnv } = useEnvironment();
	return (
		<Box flexDirection="column">
			<Text color="green">Home</Text>
			{selectedEnv && (
				<Text>Using env: {selectedEnv.name}</Text>
			)}
			<Text dimColor>{'\u2190'} Press Ctrl+C to exit</Text>
		</Box>
	);
} 