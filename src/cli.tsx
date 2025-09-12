import React from 'react';
import { render } from 'ink';
import { EnvironmentProvider } from '@context/EnvironmentContext';
import { AppLayout } from '@ui/AppLayout';
import { pages } from '@ui/navConfig';
import { FocusProvider } from '@context/FocusContext';
import { useEnvironment } from '@context/EnvironmentContext';
import { EnvSetup } from '@ui/setup/EnvSetup';

function Root() {
	const { selectedEnv } = useEnvironment();
	if (!selectedEnv) {
		return <EnvSetup />;
	}
	return <AppLayout pages={pages} />;
}

function main(): void {
	render(
		<EnvironmentProvider>
			<FocusProvider>
				<Root />
			</FocusProvider>
		</EnvironmentProvider>
	);
}

main(); 