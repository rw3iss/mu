import { h } from 'preact';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';

interface NotFoundProps {
  default?: boolean;
  path?: string;
}

export function NotFound(_props: NotFoundProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        textAlign: 'center',
        gap: 'var(--space-lg)',
        animation: 'fadeIn 300ms ease',
      }}
    >
      <div
        style={{
          fontSize: 'var(--font-size-4xl)',
          fontWeight: 'var(--font-weight-bold)',
          color: 'var(--color-accent)',
          lineHeight: '1',
        }}
      >
        404
      </div>
      <h1
        style={{
          fontSize: 'var(--font-size-2xl)',
          fontWeight: 'var(--font-weight-semibold)',
          color: 'var(--color-text-primary)',
        }}
      >
        Page Not Found
      </h1>
      <p
        style={{
          fontSize: 'var(--font-size-md)',
          color: 'var(--color-text-muted)',
          maxWidth: '400px',
        }}
      >
        The page you are looking for does not exist or has been moved.
      </p>
      <Button variant="primary" size="lg" onClick={() => route('/')}>
        Back to Home
      </Button>
    </div>
  );
}
