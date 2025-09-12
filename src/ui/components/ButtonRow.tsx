import React from 'react';
import { Box, Text } from 'ink';

export function ButtonRow({ label, focused = false }: { label: string; focused?: boolean }) {
	return (
		<Box>
			<Text color={focused ? 'yellow' : 'white'}>
				{focused ? '› ' : '  '}{label}
			</Text>
		</Box>
	);
} 