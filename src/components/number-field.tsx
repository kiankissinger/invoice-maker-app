import { useState } from 'react';
import type { TextInputProps } from 'react-native';

import { Field } from '@/components/ui';
import { parseAmount } from '@/lib/calc';
import { numberToInput } from '@/lib/format';

type Props = Omit<TextInputProps, 'value' | 'onChangeText' | 'onChange'> & {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
};

/**
 * While focused, keeps the raw text so partial input like "12." isn't clobbered;
 * otherwise mirrors `value`, so changes made elsewhere still show up.
 */
export function NumberField({ value, onChange, onFocus, onBlur, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Field
      keyboardType="decimal-pad"
      inputMode="decimal"
      value={draft ?? numberToInput(value)}
      onFocus={(e) => {
        setDraft(numberToInput(value));
        onFocus?.(e);
      }}
      onChangeText={(next) => {
        setDraft(next);
        onChange(parseAmount(next));
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
      {...rest}
    />
  );
}
