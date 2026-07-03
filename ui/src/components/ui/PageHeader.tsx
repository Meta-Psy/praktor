import type { ReactNode } from 'react';
import './PageHeader.css';

type PageHeaderProps = {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      <div>
        <h1 className="ui-page-header__title">{title}</h1>
        {subtitle && <div className="ui-page-header__subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="ui-page-header__actions">{actions}</div>}
    </header>
  );
}
