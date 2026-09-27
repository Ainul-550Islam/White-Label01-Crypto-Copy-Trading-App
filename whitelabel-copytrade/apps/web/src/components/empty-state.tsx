import { ReactNode } from 'react';
import Link from 'next/link';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  children?: ReactNode;
}

export function EmptyState({ title, description, icon, action, children }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex min-h-[300px] items-center justify-center p-8">
      <div className="max-w-md text-center">
        {icon && <div className="mx-auto mb-4 text-4xl" aria-hidden>{icon}</div>}
        <h3 className="text-lg font-semibold">{title}</h3>
        {description && <p className="mt-2 text-sm text-muted">{description}</p>}
        {children && <div className="mt-4">{children}</div>}
        {action && (
          <div className="mt-6">
            {action.href ? (
              <Link href={action.href} className="rounded bg-primary px-4 py-2 text-sm font-medium text-white">
                {action.label}
              </Link>
            ) : (
              <button onClick={action.onClick} className="rounded bg-primary px-4 py-2 text-sm font-medium text-white">
                {action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
