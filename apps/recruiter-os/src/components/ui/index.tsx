import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Accessible primitives in the shadcn/ui idiom: Tailwind-styled, composable,
 * no runtime theme layer. Dialogs use the native <dialog> element, so focus
 * trapping, Esc-to-close and the backdrop come from the platform rather than
 * from hand-written key handlers.
 */

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ready';
type ButtonSize = 'sm' | 'md';

const buttonBase =
  'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors ' +
  'disabled:cursor-not-allowed disabled:opacity-55 whitespace-nowrap';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white border-accent hover:bg-accent-hover',
  secondary: 'bg-surface text-ink border-line-strong hover:bg-surface-muted',
  ghost: 'bg-transparent text-accent border-transparent hover:bg-accent-soft',
  danger: 'bg-review text-white border-review hover:opacity-90',
  ready: 'bg-ready text-white border-ready hover:opacity-90',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'text-[13px] px-2.5 py-1.5 min-h-[32px]',
  md: 'text-[14px] px-3.5 py-2 min-h-[38px]',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type={props.type ?? 'button'}
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...props}
    />
  );
}

export function LinkButton({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <a
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], 'touch-target', className)}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-[8px] border border-line bg-surface', className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] font-semibold text-ink">
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-[13px] text-ink-faint">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 py-3', className)} {...props} />;
}

// ---------------------------------------------------------------------------
// Badges — colour is always paired with a word, and usually an icon.
// ---------------------------------------------------------------------------

export type BadgeTone = 'neutral' | 'accent' | 'ready' | 'pending' | 'review';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-ink-soft border-line-strong',
  accent: 'bg-accent-soft text-accent border-accent/25',
  ready: 'bg-ready-soft text-ready border-ready/25',
  pending: 'bg-pending-soft text-pending border-pending/25',
  review: 'bg-review-soft text-review border-review/25',
};

export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
}: {
  tone?: BadgeTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[12px] font-medium leading-4',
        badgeTones[tone],
        className,
      )}
    >
      {icon ? <span aria-hidden="true" className="shrink-0">{icon}</span> : null}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink">
        {label}
        {required ? (
          <span className="ml-1 text-review" aria-hidden="true">
            *
          </span>
        ) : (
          <span className="ml-1 text-[12px] font-normal text-ink-faint">(optional)</span>
        )}
      </label>
      {hint ? (
        <p id={hintId} className="text-[12px] text-ink-faint">
          {hint}
        </p>
      ) : null}
      <div
        data-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
      >
        {children}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-[12px] font-medium text-review">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const controlClass =
  'w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-[14px] text-ink ' +
  'placeholder:text-ink-faint disabled:bg-surface-muted disabled:text-ink-faint';

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClass, 'min-h-[38px]', className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlClass, 'min-h-[88px] leading-relaxed', className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(controlClass, 'min-h-[38px] pr-8', className)} {...props} />;
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function Notice({
  tone = 'neutral',
  title,
  children,
  icon,
  className,
}: {
  tone?: BadgeTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: 'border-line-strong bg-surface-muted text-ink-soft',
    accent: 'border-accent/30 bg-accent-soft text-ink',
    ready: 'border-ready/30 bg-ready-soft text-ink',
    pending: 'border-pending/30 bg-pending-soft text-ink',
    review: 'border-review/30 bg-review-soft text-ink',
  };
  return (
    <div
      role={tone === 'review' ? 'alert' : 'status'}
      className={cn('flex gap-2 rounded-md border px-3 py-2 text-[13px]', tones[tone], className)}
    >
      {icon ? <span aria-hidden="true" className="mt-0.5 shrink-0">{icon}</span> : null}
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-0.5')}>{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon ? <span aria-hidden="true" className="text-ink-faint">{icon}</span> : null}
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      <p className="max-w-md text-[13px] text-ink-faint">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded bg-line', className)}
    />
  );
}

export function DefinitionList({
  items,
  className,
}: {
  items: Array<{ label: string; value: React.ReactNode }>;
  className?: string;
}) {
  return (
    <dl className={cn('grid gap-x-4 gap-y-2 sm:grid-cols-2', className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[12px] uppercase tracking-wide text-ink-faint">{item.label}</dt>
          <dd className="mt-0.5 text-[13px] text-ink break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={cn('text-[12px] font-semibold uppercase tracking-wide text-ink-faint', className)}>
      {children}
    </h3>
  );
}
