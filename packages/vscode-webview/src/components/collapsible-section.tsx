import { ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';

interface CollapsibleSectionProps {
  title: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
}

/** Plain hand-rolled disclosure — no HeroUI Accordion needed for a single
 * chevron-rotate section header, matching the small-surface-area approach
 * already used for Popover/Select/ListBox elsewhere in this package. */
export function CollapsibleSection({
  title,
  icon,
  defaultOpen = true,
  action,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border">
      <div className="flex items-center gap-1.5 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] font-semibold tracking-wide text-text-secondary uppercase hover:text-text-primary"
        >
          <ChevronRight
            className={'h-3 w-3 shrink-0 transition-transform' + (open ? ' rotate-90' : '')}
            aria-hidden="true"
          />
          {icon}
          <span className="truncate">{title}</span>
        </button>
        {action}
      </div>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}
