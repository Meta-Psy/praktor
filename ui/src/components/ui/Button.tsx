import type { ButtonHTMLAttributes } from 'react';
import './Button.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md';
  busy?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  busy = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const cls = ['ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, className]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} disabled={disabled || busy} {...rest}>
      {busy && <span className="ui-btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
