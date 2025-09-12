import React from 'react';
import { Box, Text } from 'ink';

export function ProgressLog({ lines, height }: { lines: string[]; height: number }) {
	const visible = lines.slice(-height);
	return (
		<Box flexDirection="column">
			{visible.map((l, i) => (
				<Text key={i} dimColor>{l}</Text>
			))}
		</Box>
	);
} 