import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export type FocusContextValue = {
	activeRegionId?: string;
	requestFocus: (regionId: string) => void;
	releaseFocus: (regionId: string) => void;
	isActive: (regionId: string) => boolean;
};

const FocusContext = createContext<FocusContextValue | undefined>(undefined);

export function FocusProvider({ children }: { children: React.ReactNode }) {
	const [activeRegionId, setActiveRegionId] = useState<string | undefined>(undefined);
	const ownerRef = useRef<string | undefined>(undefined);

	const requestFocus = useCallback((regionId: string) => {
		ownerRef.current = regionId;
		setActiveRegionId(regionId);
	}, []);

	const releaseFocus = useCallback((regionId: string) => {
		if (ownerRef.current === regionId) {
			ownerRef.current = undefined;
			setActiveRegionId(undefined);
		}
	}, []);

	const isActive = useCallback((regionId: string) => activeRegionId === regionId, [activeRegionId]);

	const value = useMemo<FocusContextValue>(() => ({ activeRegionId, requestFocus, releaseFocus, isActive }), [activeRegionId, requestFocus, releaseFocus, isActive]);

	return (
		<FocusContext.Provider value={value}>
			{children}
		</FocusContext.Provider>
	);
}

export function useFocusContext(): FocusContextValue {
	const ctx = useContext(FocusContext);
	if (!ctx) throw new Error('useFocusContext must be used within FocusProvider');
	return ctx;
}

export function useFocusRegion(regionId: string, enabled: boolean): void {
	const { requestFocus, releaseFocus } = useFocusContext();
	React.useEffect(() => {
		if (enabled) requestFocus(regionId);
		return () => releaseFocus(regionId);
	}, [enabled, regionId, requestFocus, releaseFocus]);
}

export function useGlobalHotkeysEnabled(): boolean {
	const { activeRegionId } = useFocusContext();
	return !activeRegionId;
} 