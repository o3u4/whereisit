/*
 * whereisit · shared UI primitives (thin React wrappers over the design-system CSS).
 * The heavier page composites (tree rail, scene cards, item sheets, spotlight…)
 * live in their own page components — these are only the genuinely-reused pieces.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, CDot, type IconName } from './icons';
import { STATUS } from '../lib/meta';
import type { ItemStatus } from '../lib/types';
import { useToast } from '../stores/toast';
import { intl } from '../i18n';

/* ------------------------------------------------ wordmark --------------- */
export function Wordmark({ home = '/' }: { home?: string }) {
  return (
    <Link className="wordmark" to={home} aria-label="whereisit">
      <span className="tild">~/</span>whereisit<span className="dot" />
    </Link>
  );
}

/* ------------------------------------------------ badge ------------------ */
export type StatusCls = ItemStatus;

export function StatusBadge({ cls, label }: { cls: StatusCls; label: string }) {
  return (
    <span className={`badge badge--status-${cls}`}>
      <CDot />
      {label}
    </span>
  );
}

/* ------------------------------------------------ seg -------------------- */
export interface SegOption {
  value: string;
  label: ReactNode;
}

export function Seg({
  value,
  onChange,
  options,
  className,
  fluid,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SegOption[];
  className?: string;
  /** make the whole group stretch full width */
  fluid?: boolean;
}) {
  return (
    <div
      className={`seg${className ? ` ${className}` : ''}`}
      role="tablist"
      style={fluid ? { width: '100%', display: 'flex' } : undefined}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          data-value={o.value}
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          style={fluid ? { flex: 1 } : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------ stepper ---------------- */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 9999,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  const set = (d: number) => onChange(Math.max(min, Math.min(max, value + d)));
  return (
    <span className="stepper">
      <button type="button" aria-label={intl.t('app.decrease')} onClick={() => set(-1)}>
        −
      </button>
      <span className="val">{value}</span>
      <button type="button" aria-label={intl.t('app.increase')} onClick={() => set(1)}>
        +
      </button>
    </span>
  );
}

/* ------------------------------------------------ switch ----------------- */
export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <span
      className="switch"
      role="switch"
      aria-checked={on}
      tabIndex={0}
      onClick={() => onChange(!on)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onChange(!on);
        }
      }}
    />
  );
}

/* ------------------------------------------------ overlay sheets ---------- */
export function Dim({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return <div className={`dim${on ? ' show' : ''}`} onClick={onClick} aria-hidden={!on} />;
}

export function Sheet({
  open,
  onClose,
  side,
  title,
  grab,
  children,
  className,
  bodyClassName,
  ariaLabel,
  plain,
  footer,
  noDim,
}: {
  open: boolean;
  onClose: () => void;
  side: 'right' | 'bottom';
  title?: ReactNode;
  grab?: boolean;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  ariaLabel?: string;
  /** skip the standard .sheet-body wrapper (caller controls body+footer layout) */
  plain?: boolean;
  footer?: ReactNode;
  /** suppress the backdrop dim (used in wide split mode: spotlight + detail side by side) */
  noDim?: boolean;
}) {
  const closeBtn = (
    <button type="button" className="ibtn" onClick={onClose} aria-label={intl.t('app.close')}>
      <Icon name="x" />
    </button>
  );
  return (
    <>
      {!noDim ? <Dim on={open} onClick={onClose} /> : null}
      <aside
        className={`sheet sheet--${side}${open ? ' show' : ''}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
      >
        {grab ? <div className="sheet-grab" /> : null}
        {title !== undefined ? (
          <div className="sheet-head">
            <h3>{title}</h3>
            {closeBtn}
          </div>
        ) : null}
        {plain ? (
          children
        ) : (
          <div className={`sheet-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>
            {children}
            {footer}
          </div>
        )}
        {plain && footer ? footer : null}
      </aside>
    </>
  );
}

/* ------------------------------------------------ misc ------------------- */
export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export function EmptyState({
  icon = 'search',
  title,
  hint,
  action,
}: {
  icon?: IconName;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={24} style={{ color: 'var(--faint)' }} />
      <b>{title}</b>
      {hint ? <span>{hint}</span> : null}
      {action}
    </div>
  );
}

/** status text/label helper — translates the STATUS dict key at call time. */
export const statusLabel = (s: string): string =>
  s === 'present' || s === 'lent' || s === 'consumed' ? intl.t(STATUS[s as ItemStatus].label) : s;

/** build toast host (fixed). Consumes the global toast store. */
export function ToastsHost() {
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          {t.tone ? <CDot color="var(--accent)" /> : null}
          {t.text}
          {t.actionLabel && t.action ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                dismiss(t.id);
                t.action?.();
              }}
            >
              {t.actionLabel}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
