import React from 'react';
import { Box, Text } from 'ink';

export type Column = { label: string; width: number };

function pad(text: string, width: number): string {
	if (text.length >= width) return text.slice(0, width - 1) + '…';
	return text + ' '.repeat(width - text.length);
}

export function Table({ columns, rows, activeIndex }: { columns: Column[]; rows: string[][]; activeIndex?: number }) {
	return (
		<Box flexDirection="column">
			<Text>
				{columns.map((c) => pad(c.label, c.width)).join('')}
			</Text>
			{rows.map((r, idx) => (
				<Text key={idx} color={activeIndex === idx ? 'cyan' : undefined}>
					{r.map((cell, i) => pad(cell ?? '', columns[i]?.width ?? 10)).join('')}
				</Text>
			))}
		</Box>
	);
} 