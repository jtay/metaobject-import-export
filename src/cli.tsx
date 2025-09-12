import React from 'react';
import { render } from 'ink';
import { EnvironmentProvider } from '@context/EnvironmentContext';
import { AppLayout } from '@ui/AppLayout';
import { pages } from '@ui/navConfig';
import { FocusProvider } from '@context/FocusContext';
import { useEnvironment } from '@context/EnvironmentContext';
import { EnvSetup } from '@ui/setup/EnvSetup';
import { NavigationProvider } from '@context/NavigationContext';
import { ImportProvider } from '@context/ImportContext';

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
				<NavigationProvider>
					<ImportProvider>
						<Root />
					</ImportProvider>
				</NavigationProvider>
			</FocusProvider>
		</EnvironmentProvider>
	);
}

main(); 