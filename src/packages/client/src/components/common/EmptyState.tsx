import { h } from 'preact';
import { Button } from './Button';
import styles from './EmptyState.module.scss';

interface EmptyStateProps {
  icon?: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div class={styles.container}>
      {icon && <span class={styles.icon}>{icon}</span>}
      <h3 class={styles.title}>{title}</h3>
      {message && <p class={styles.message}>{message}</p>}
      {actionLabel && onAction && (
        <Button variant="primary" size="md" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
