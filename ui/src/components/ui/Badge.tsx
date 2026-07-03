import type { HTMLAttributes } from 'react';
import './Badge.css';

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: 'ok' | 'warn' | 'danger' | 'accent' | 'neutral';
};

export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  const cls = ['ui-badge', `ui-badge--${tone}`, className].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
