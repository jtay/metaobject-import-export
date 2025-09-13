import React from 'react';
import { render } from 'ink';
import { EnvironmentProvider } from '@context/EnvironmentContext';
import { AppLayout } from '@ui/AppLayout';
import { pages } from '@ui/navConfig';
import { FocusProvider } from '@context/FocusContext';
import { NavigationProvider } from '@context/NavigationContext';
import { ImportProvider } from '@context/ImportContext';

function main(): void {
	render(
		<EnvironmentProvider>
			<FocusProvider>
				<NavigationProvider>
					<ImportProvider>
						<AppLayout pages={pages} />
					</ImportProvider>
				</NavigationProvider>
			</FocusProvider>
		</EnvironmentProvider>
	);
}

main(); 