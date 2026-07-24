import { ListBox, Select } from '@heroui/react';
import { Check, ChevronDown, Zap } from 'lucide-react';
import type { ReactNode } from 'react';

import { assetUrl } from '../utils/asset-url.ts';
import type { ModelOption } from '../utils/types.ts';

interface ModelPickerProps {
  models: ModelOption[];
  selectedId: string;
  onSelect: (modelId: string) => void;
}

const PROVIDER_ICON: Record<string, string> = {
  anthropic: '/images/model-provider/anthropic.svg',
  deepseek: '/images/model-provider/deepseek.svg',
};

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
};

function ProviderIcon({ provider, size }: { provider: string | undefined; size: number }) {
  const src = provider && PROVIDER_ICON[provider];
  if (!src)
    return (
      <Zap
        className="shrink-0 text-text-secondary"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  return (
    <img src={assetUrl(src)} alt="" width={size} height={size} className="shrink-0 rounded-[4px]" />
  );
}

const headerKey = (provider: string) => `__hdr_${provider}`;

/** Mirrors digital-factory-ui's prompt-input.tsx ModelPicker: HeroUI Select +
 * ListBox so the popover portals out (can't be clipped by the input
 * container's overflow), grouped into per-provider sections rendered as
 * disabled ListBox items (react-aria's Section/Header aren't reachable
 * through HeroUI here, hence the flat rows array + disabledKeys trick).
 * Restyled with our own vscode-token classes instead of digital-factory-ui's
 * fixed --color-* palette. */
export function ModelPicker({ models, selectedId, onSelect }: ModelPickerProps) {
  if (!models.length) return null;

  const current = models.find((m) => m.id === selectedId);
  const providers = Array.from(new Set(models.map((m) => m.provider)));

  const rows: ReactNode[] = [];
  for (const provider of providers) {
    rows.push(
      <ListBox.Item
        key={headerKey(provider)}
        id={headerKey(provider)}
        textValue={PROVIDER_LABEL[provider] ?? provider}
        className="pointer-events-none px-3 pb-1 pt-2 text-[10px]! font-bold! tracking-widest text-text-muted! uppercase"
      >
        {PROVIDER_LABEL[provider] ?? provider}
      </ListBox.Item>,
    );
    for (const m of models.filter((x) => x.provider === provider)) {
      rows.push(
        <ListBox.Item
          key={m.id}
          id={m.id}
          textValue={m.label}
          className="flex cursor-pointer items-center justify-between gap-2.5 rounded-md px-3 py-1.5 text-[12.5px]! text-text-primary! outline-none hover:bg-surface-secondary! data-[focused]:bg-surface-secondary! data-[selected]:bg-surface-secondary!"
        >
          {({ isSelected }: { isSelected: boolean }) => (
            <>
              <span className="flex min-w-0 items-center gap-2">
                <ProviderIcon provider={m.provider} size={14} />
                <span className="truncate">{m.label}</span>
              </span>
              {isSelected && <Check className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />}
            </>
          )}
        </ListBox.Item>,
      );
    }
  }

  return (
    <Select.Root
      selectedKey={selectedId || null}
      onSelectionChange={(key) => {
        const id = key == null ? '' : String(key);
        if (id && !id.startsWith('__hdr_')) onSelect(id);
      }}
      isDisabled={models.length === 0}
      aria-label="Select model"
    >
      <Select.Trigger className="flex! h-auto! min-h-0! w-auto! items-center gap-1.5 rounded border-0 bg-transparent px-1.5! py-1! text-[10.5px]! text-text-secondary shadow-none hover:bg-surface-secondary hover:text-text-primary">
        {current ? (
          <ProviderIcon provider={current.provider} size={12} />
        ) : (
          <Zap className="h-3 w-3 shrink-0" aria-hidden="true" />
        )}
        {/* Select.Value merges this className with @heroui/react's own
            "value" slot classes (select.js: composeTwRenderProps(className,
            slots?.value())) — that slot's own font-size wins on this exact
            node regardless of what's set on the outer Select.Trigger above,
            since font-size doesn't cascade past a child's own explicit rule.
            The size utility has to live here, not on the Trigger. */}
        <Select.Value className="truncate text-[10.5px]!">
          {({ selectedText, isPlaceholder }: { selectedText: string; isPlaceholder: boolean }) =>
            isPlaceholder ? 'Model' : selectedText
          }
        </Select.Value>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
      </Select.Trigger>
      <Select.Popover
        placement="top start"
        className="min-w-52 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-xl"
      >
        <ListBox
          disabledKeys={providers.map((p) => headerKey(p))}
          className="max-h-64 overflow-auto outline-none"
        >
          {rows}
        </ListBox>
      </Select.Popover>
    </Select.Root>
  );
}
