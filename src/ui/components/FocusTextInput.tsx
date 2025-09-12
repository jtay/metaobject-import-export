import React from 'react';
import TextInput from 'ink-text-input';
import { useFocusRegion } from '@context/FocusContext';

export type FocusTextInputProps = React.ComponentProps<typeof TextInput> & { focusId?: string };

export function FocusTextInput({ focus, focusId = 'text-input', ...rest }: FocusTextInputProps) {
	useFocusRegion(focusId, Boolean(focus));
	return <TextInput focus={focus} {...rest} />;
} 