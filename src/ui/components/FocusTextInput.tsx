import React from 'react';
import TextInput from 'ink-text-input';
import { useFocusContext, useFocusRegion } from '@context/FocusContext';

export type FocusTextInputProps = React.ComponentProps<typeof TextInput> & { focusId?: string };

export function FocusTextInput({ focus, focusId = 'text-input', ...rest }: FocusTextInputProps) {
	useFocusRegion(focusId, Boolean(focus));
	const { activeRegionId } = useFocusContext();
	const pageHasFocus = Boolean(activeRegionId);
	const effectiveFocus = Boolean(focus && pageHasFocus);
	return <TextInput focus={effectiveFocus} {...rest} />;
} 