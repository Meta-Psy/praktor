import type { ReactNode } from 'react';
import './EmptyState.css';

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({ icon, title, hint, action }: EmptyStateProps) {
  return (
    <div className="ui-empty">
      {icon && <div className="ui-empty__icon">{icon}</div>}
      <div className="ui-empty__title">{title}</div>
      {hint && <div className="ui-empty__hint">{hint}</div>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}
