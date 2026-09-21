'use client';
import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './index';

/**
 * Modal built on the native <dialog> element.
 *
 * `showModal()` gives us the focus trap, Esc-to-close, inert background and
 * the ::backdrop for free — all things hand-rolled modals get wrong.
 */
export function Dialog({
  trigger,
  title,
  description,
  children,
  width = 'md',
}: {
  trigger: (open: () => void) => React.ReactNode;
  title: string;
  description?: string;
  children: (close: () => void) => React.ReactNode;
  width?: 'sm' | 'md' | 'lg';
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = React.useState(false);

  // Opening and closing is state, and the effect below is the only place that
  // touches the element: the callbacks handed to the trigger and the children
  // never read the ref, so they are safe to call from anywhere.
  const open = React.useCallback(() => setMounted(true), []);
  const close = React.useCallback(() => setMounted(false), []);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // The children are already in the DOM by the time this runs, so
    // showModal() traps focus on real content.
    if (mounted && !element.open) element.showModal();
    if (!mounted && element.open) element.close();
  }, [mounted]);

  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' };

  return (
    <>
      {trigger(open)}
      <dialog
        ref={ref}
        aria-labelledby="dialog-title"
        onClose={close}
        className={cn(
          'w-[calc(100vw-2rem)] rounded-[8px] border border-line bg-surface p-0 text-ink shadow-lg',
          'backdrop:bg-ink/45',
          widths[width],
        )}
      >
        {mounted ? (
          <div className="flex max-h-[85vh] flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <h2 id="dialog-title" className="text-[15px] font-semibold">
                  {title}
                </h2>
                {description ? <p className="mt-0.5 text-[13px] text-ink-faint">{description}</p> : null}
              </div>
              <Button variant="ghost" size="sm" onClick={close} aria-label="Close dialog">
                <X size={16} aria-hidden="true" />
              </Button>
            </div>
            <div className="overflow-y-auto px-4 py-3">{children(close)}</div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
