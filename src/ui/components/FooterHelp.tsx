import React from 'react';
import { Box, Text } from 'ink';

export function FooterHelp({ children }: { children?: React.ReactNode }) {
	return (
		<Box marginTop={0}>
			<Text dimColor>{children}</Text>
		</Box>
	);
} 