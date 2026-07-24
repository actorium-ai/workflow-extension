import { ListBox, Select } from '@heroui/react';
import { Check, ChevronDown, ClipboardList, Hand, Zap } from 'lucide-react';
import type { ComponentType } from 'react';

import type { OperationalMode } from '../utils/types.ts';

interface ModeSelectProps {
  mode: OperationalMode;
  onSetMode: (mode: OperationalMode) => void;
}

const MODES: {
  id: OperationalMode;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { id: 'ask', label: 'Ask', description: 'Approve each edit before it’s applied.', icon: Hand },
  {
    id: 'plan',
    label: 'Plan',
    description: 'Read-only — explores and plans without editing.',
    icon: ClipboardList,
  },
  {
    id: 'auto',
    label: 'Auto',
    description: 'Applies safe changes automatically, pauses for anything risky.',
    icon: Zap,
  },
];

/** Compact HeroUI Select replacing the old Ask/Plan/Auto segmented button
 * group — trigger stays compact, but the open dropdown shows an icon +
 * description per mode (mirrors Claude Code's own IDE mode picker). */
export function ModeSelect({ mode, onSetMode }: ModeSelectProps) {
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];
  const CurrentIcon = current.icon;

  return (
    <Select.Root
      selectedKey={mode}
      onSelectionChange={(key) => {
        if (key) onSetMode(String(key) as OperationalMode);
      }}
      aria-label="Select mode"
    >
      <Select.Trigger className="flex! h-auto! min-h-0! w-auto! items-center gap-1.5 rounded border-0 bg-transparent px-1.5! py-1! text-[10.5px]! text-text-secondary shadow-none hover:bg-surface-secondary hover:text-text-primary">
        <CurrentIcon className="h-3 w-3 shrink-0" />
        {/* See model-picker.tsx's ModelPicker: the size utility has to be on
            Select.Value itself, not the outer Select.Trigger — @heroui/react's
            Select.Value merges its own "value" slot classes into this
            element's className, and that slot's own font-size wins here
            regardless of what's set on an ancestor. */}
        <Select.Value className="truncate text-[10.5px]!">{current.label}</Select.Value>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
      </Select.Trigger>
      <Select.Popover
        placement="top end"
        className="min-w-72 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-xl"
      >
        <div className="px-3 pb-1 pt-2 text-[10px] font-semibold tracking-wider text-text-muted uppercase">
          Modes
        </div>
        <ListBox className="outline-none">
          {MODES.map((m) => {
            const Icon = m.icon;
            return (
              <ListBox.Item
                key={m.id}
                id={m.id}
                textValue={m.label}
                className="flex cursor-pointer items-start gap-2.5 rounded-md px-3 py-2 text-text-primary! outline-none hover:bg-surface-secondary! data-[focused]:bg-surface-secondary! data-[selected]:bg-surface-secondary!"
              >
                {({ isSelected }: { isSelected: boolean }) => (
                  <>
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[13px] font-medium">{m.label}</span>
                      <span className="text-[11.5px] leading-snug text-text-muted">
                        {m.description}
                      </span>
                    </span>
                    {isSelected && (
                      <Check
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                    )}
                  </>
                )}
              </ListBox.Item>
            );
          })}
        </ListBox>
      </Select.Popover>
    </Select.Root>
  );
}
