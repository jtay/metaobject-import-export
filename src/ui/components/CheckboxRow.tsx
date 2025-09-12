import React from 'react';
import { Box, Text } from 'ink';

export function CheckboxRow({ label, checked, focused = false }: { label: string; checked: boolean; focused?: boolean }) {
	return (
		<Box>
			<Text color={focused ? 'yellow' : 'white'}>
				[{checked ? 'x' : ' '}] {label}
			</Text>
		</Box>
	);
} 