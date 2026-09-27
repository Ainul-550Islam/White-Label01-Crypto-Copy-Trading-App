import Link from 'next/link';

export default function NotFound(): JSX.Element {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Page not found</h1>
        <p style={{ color: 'var(--wlct-color-text-muted)', fontSize: 14 }}>
          The page you requested does not exist.
        </p>
        <Link href="/dashboard" style={{ fontSize: 14 }}>
          Back to the overview
        </Link>
      </div>
    </main>
  );
}
