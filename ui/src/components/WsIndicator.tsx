import { useWebSocket } from '../hooks/useWebSocket';

const LABELS = {
  connected: 'в сети',
  connecting: 'подключение…',
  disconnected: 'нет связи',
} as const;

const COLORS = {
  connected: 'var(--green)',
  connecting: 'var(--amber)',
  disconnected: 'var(--red)',
} as const;

export function WsIndicator() {
  const { status } = useWebSocket();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        fontSize: 13,
        color: 'var(--text-secondary)',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: COLORS[status],
          flexShrink: 0,
        }}
      />
      {LABELS[status]}
    </div>
  );
}
