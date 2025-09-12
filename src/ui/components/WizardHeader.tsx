import React from 'react';
import { Box, Text } from 'ink';

export function WizardHeader({ title, step, total }: { title: string; step?: number; total?: number }) {
	return (
		<Box marginBottom={1} justifyContent="space-between">
			<Text color="green">{title}</Text>
			{step && total ? <Text dimColor>Step {step} of {total}</Text> : null}
		</Box>
	);
} 