import React from 'react';
import { render } from 'ink';
import { EnvironmentProvider, useEnvironment } from '@context/EnvironmentContext';
import { EnvSelector } from '@ui/EnvSelector';
import { Home } from '@ui/Home';

function Root() {
	const { selectedEnv } = useEnvironment();
	return selectedEnv ? <Home /> : <EnvSelector />;
}

function main(): void {
	render(
		<EnvironmentProvider>
			<Root />
		</EnvironmentProvider>
	);
}

main(); 