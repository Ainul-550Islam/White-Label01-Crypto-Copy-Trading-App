import type { CSSProperties, ReactNode } from 'react';

import { theme, type StatusTone } from '@/lib/theme';

/**
 * Primitive presentational components.
 *
 * Deliberately dependency-free and inline-styled: the console must render
 * correctly in restricted preview environments where external stylesheets do
 * not load, and Part 1 should not lock the project into a component library.
 */

export function Card({
  title,
  description,
  actions,
  children,
  style,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <section
      style={{
        background: theme.color.surface,
        border: `1px solid ${theme.color.border}`,
        borderRadius: theme.radius.lg,
        padding: theme.space(6),
        ...style,
      }}
    >
      {(title || actions) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: theme.space(4),
            marginBottom: description || children ? theme.space(4) : 0,
          }}
        >
          <div>
            {title && (
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h2>
            )}
            {description && (
              <p style={{ margin: `${theme.space(1)} 0 0`, color: theme.color.textMuted, fontSize: 13 }}>
                {description}
              </p>
            )}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

const toneColors: Record<StatusTone, { fg: string; bg: string }> = {
  neutral: { fg: 'var(--wlct-color-text-muted)', bg: 'rgba(154, 165, 196, 0.14)' },
  success: { fg: 'var(--wlct-color-success)', bg: 'rgba(47, 191, 113, 0.14)' },
  warning: { fg: 'var(--wlct-color-warning)', bg: 'rgba(232, 163, 61, 0.16)' },
  danger: { fg: 'var(--wlct-color-danger)', bg: 'rgba(229, 72, 77, 0.16)' },
  info: { fg: 'var(--wlct-color-primary)', bg: 'rgba(79, 124, 255, 0.16)' },
};

export function Badge({ tone = 'neutral', children }: { tone?: StatusTone; children: ReactNode }): JSX.Element {
  const colors = toneColors[tone];

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 0.2,
        color: colors.fg,
        background: colors.bg,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}): JSX.Element {
  return (
    <div
      style={{
        background: theme.color.surface,
        border: `1px solid ${theme.color.border}`,
        borderRadius: theme.radius.md,
        padding: theme.space(4),
      }}
    >
      <div style={{ color: theme.color.textMuted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: theme.space(2) }}>{value}</div>
      {hint && (
        <div style={{ color: theme.color.textMuted, fontSize: 12, marginTop: theme.space(1) }}>{hint}</div>
      )}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }): JSX.Element {
  return (
    <div
      style={{
        padding: theme.space(10),
        textAlign: 'center',
        color: theme.color.textMuted,
        border: `1px dashed ${theme.color.border}`,
        borderRadius: theme.radius.md,
      }}
    >
      <div style={{ fontWeight: 600, color: theme.color.text }}>{title}</div>
      {description && <div style={{ marginTop: theme.space(2), fontSize: 13 }}>{description}</div>}
    </div>
  );
}

export function ErrorNotice({ title, message }: { title: string; message: string }): JSX.Element {
  return (
    <div
      role="alert"
      style={{
        padding: theme.space(4),
        borderRadius: theme.radius.md,
        border: '1px solid rgba(229, 72, 77, 0.4)',
        background: 'rgba(229, 72, 77, 0.1)',
        color: theme.color.text,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: theme.space(1) }}>{title}</div>
      <div style={{ fontSize: 13, color: theme.color.textMuted }}>{message}</div>
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  width?: string;
  align?: 'left' | 'right' | 'center';
}

export function DataTable<T>({
  columns,
  rows,
  emptyTitle = 'Nothing to show yet',
  emptyDescription,
  rowKey,
}: {
  columns: Array<Column<T>>;
  rows: T[];
  emptyTitle?: string;
  emptyDescription?: string;
  rowKey: (row: T, index: number) => string;
}): JSX.Element {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ fontSize: 14 }}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={{
                  textAlign: column.align ?? 'left',
                  padding: `${theme.space(2)} ${theme.space(3)}`,
                  borderBottom: `1px solid ${theme.color.border}`,
                  color: theme.color.textMuted,
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                  fontWeight: 600,
                  width: column.width,
                  whiteSpace: 'nowrap',
                }}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  style={{
                    textAlign: column.align ?? 'left',
                    padding: `${theme.space(3)} ${theme.space(3)}`,
                    borderBottom: `1px solid ${theme.color.border}`,
                    verticalAlign: 'top',
                  }}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <header
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: theme.space(4),
        marginBottom: theme.space(6),
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{title}</h1>
        {description && (
          <p style={{ margin: `${theme.space(2)} 0 0`, color: theme.color.textMuted, fontSize: 14, maxWidth: 720 }}>
            {description}
          </p>
        )}
      </div>
      {actions}
    </header>
  );
}
