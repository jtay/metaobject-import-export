import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import fs from 'node:fs';
import path from 'node:path';
import { FocusTextInput } from '@ui/components/FocusTextInput';
import type { EnvironmentFile } from '@context/EnvironmentContext';

export function NewEnvForm({ onCreated, onCancel }: { onCreated: (env: EnvironmentFile) => void; onCancel?: () => void }) {
	const cwd = process.cwd();
	const examplePath = path.join(cwd, 'example.env');
	const [keys, setKeys] = useState<string[]>([]);
	const [envName, setEnvName] = useState<string>('development');
	const [values, setValues] = useState<Record<string, string>>({});
	const [activeIndex, setActiveIndex] = useState<number>(-1); // -1 is envName field
	const [error, setError] = useState<string | undefined>(undefined);

	useEffect(() => {
		try {
			const content = fs.existsSync(examplePath) ? fs.readFileSync(examplePath, 'utf8') : '';
			const parsedKeys = content
				.split(/\r?\n/)
				.map(line => line.trim())
				.filter(line => line.length > 0 && !line.startsWith('#'))
				.map(line => line.split('=')[0]?.trim())
				.filter(Boolean);
			setKeys(parsedKeys);
			setValues(parsedKeys.reduce<Record<string, string>>((acc, k) => { acc[k] = ''; return acc; }, {}));
		} catch {
			setKeys([]);
		}
	}, [examplePath]);

	useInput((input, key) => {
		if (key.upArrow) {
			setActiveIndex(prev => (prev <= -1 ? keys.length - 1 : prev - 1));
		}
		if (key.downArrow || input === '\t') {
			setActiveIndex(prev => (prev >= keys.length ? -1 : prev + 1));
		}
		if (key.return) {
			submit();
		}
		if (key.escape && onCancel) onCancel();
	});

	const canSubmit = useMemo(() => envName.trim().length > 0, [envName]);

	function submit() {
		setError(undefined);
		if (!canSubmit) return;
		const fileName = `.env.${envName.trim()}`;
		const targetPath = path.join(cwd, fileName);
		if (fs.existsSync(targetPath)) {
			setError(`${fileName} already exists. Choose a different environment name.`);
			return;
		}
		const lines: string[] = keys.map(k => `${k}=${values[k] ?? ''}`);
		try {
			fs.writeFileSync(targetPath, lines.join('\n'), 'utf8');
			onCreated({ name: fileName, path: targetPath });
		} catch (e) {
			setError(`Failed to write ${fileName}: ${String(e)}`);
		}
	}

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text>Environment name (used for .env.&lt;name&gt;):</Text>
			</Box>
			<FocusTextInput
				focus={activeIndex === -1}
				value={envName}
				onChange={setEnvName}
				placeholder="development"
				focusId="new-env-name"
			/>
			<Box marginTop={1} flexDirection="column">
				<Text>Values</Text>
				{keys.length === 0 ? (
					<Text dimColor>No keys found in example.env. A blank file will be created.</Text>
				) : null}
				{keys.map((k, idx) => (
					<Box key={k}>
						<Box width={30}><Text>{k}</Text></Box>
						<FocusTextInput
							focus={activeIndex === idx}
							value={values[k] ?? ''}
							onChange={(v) => setValues(prev => ({ ...prev, [k]: v }))}
							placeholder=""
							focusId={`new-env-${k}`}
						/>
					</Box>
				))}
			</Box>
			<Box marginTop={1}>
				<Text>
					Enter to create, Tab/Arrows to navigate{onCancel ? ', Esc to cancel' : ''}
				</Text>
			</Box>
			{error ? (
				<Box marginTop={1}><Text color="red">{error}</Text></Box>
			) : null}
		</Box>
	);
} 