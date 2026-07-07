import type { HTMLAttributes } from 'react';
import './Card.css';

type CardProps = HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
};

export function Card({ interactive = false, className, children, ...rest }: CardProps) {
  const cls = ['ui-card', interactive ? 'ui-card--interactive' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
