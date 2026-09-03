import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './icons';

/** mobile bottom tab bar host (hidden on desktop via CSS) */
export function TabBar({ children }: { children: ReactNode }) {
  return (
    <div className="tabbar-wrap" aria-label="主导航">
      <nav className="tabbar">{children}</nav>
    </div>
  );
}

export function TabLink({
  to,
  icon,
  label,
  current,
  pill,
}: {
  to: string;
  icon: IconName;
  label: string;
  current?: boolean;
  /** elevated circular add button (record) */
  pill?: boolean;
}) {
  if (pill) {
    return (
      <Link className="tab tab-plus" to={to} aria-label={label} title={label}>
        <Icon name={icon} size={22} />
      </Link>
    );
  }
  return (
    <Link className="tab" to={to} aria-current={current || undefined}>
      <Icon name={icon} size={21} />
      {label}
    </Link>
  );
}

export function TabAction({
  icon,
  label,
  onClick,
  current,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  current?: boolean;
}) {
  return (
    <button type="button" className="tab" aria-current={current || undefined} onClick={onClick}>
      <Icon name={icon} size={21} />
      {label}
    </button>
  );
}
