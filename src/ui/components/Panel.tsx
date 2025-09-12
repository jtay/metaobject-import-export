import React from 'react';
import { Box, Text } from 'ink';

export function Panel({ title, children, borderColor = 'gray' }: { title?: string; children?: React.ReactNode; borderColor?: string }) {
	return (
		<Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1} paddingY={0}>
			{title ? (
				<Box marginBottom={0}><Text color="cyan">{title}</Text></Box>
			) : null}
			{children}
		</Box>
	);
} 