import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export type NavigationRequest = { key: string; seq: number };

export type NavigationContextValue = {
	navigate: (key: string) => void;
	request?: NavigationRequest;
};

const NavigationContext = createContext<NavigationContextValue | undefined>(undefined);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
	const seqRef = useRef(0);
	const [request, setRequest] = useState<NavigationRequest | undefined>(undefined);

	const navigate = useCallback((key: string) => {
		seqRef.current += 1;
		setRequest({ key, seq: seqRef.current });
	}, []);

	const value = useMemo<NavigationContextValue>(() => ({ navigate, request }), [navigate, request]);

	return (
		<NavigationContext.Provider value={value}>
			{children}
		</NavigationContext.Provider>
	);
}

export function useNavigation(): NavigationContextValue {
	const ctx = useContext(NavigationContext);
	if (!ctx) throw new Error('useNavigation must be used within NavigationProvider');
	return ctx;
} 