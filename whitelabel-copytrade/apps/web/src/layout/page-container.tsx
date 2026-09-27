import { ReactNode } from 'react';

interface PageContainerProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function PageContainer({ title, description, actions, children, className }: PageContainerProps): JSX.Element {
  return (
    <div className={`space-y-6 ${className ?? ''}`}>
      {(title || description || actions) && (
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            {title && <h1 className="text-2xl font-bold tracking-tight">{title}</h1>}
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div>{children}</div>
    </div>
  );
}

export function Section({ title, description, children, className }: { title?: string; description?: string; children: ReactNode; className?: string }): JSX.Element {
  return (
    <section className={`rounded-lg border bg-card p-6 ${className ?? ''}`}>
      {(title || description) && (
        <div className="mb-4">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
      )}
      <div>{children}</div>
    </section>
  );
}
