import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface WsEvent {
  type: string;
  agent_id?: string;
  data: unknown;
  timestamp: string;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

type WsApi = {
  events: WsEvent[];
  status: ConnectionStatus;
  clearEvents: () => void;
};

const WebSocketContext = createContext<WsApi | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<WsEvent[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
    };

    ws.onmessage = (evt) => {
      try {
        const event: WsEvent = JSON.parse(evt.data);
        setEvents((prev) => [...prev.slice(-500), event]);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setStatus('disconnected');
      wsRef.current = null;
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const clearEvents = useCallback(() => setEvents([]), []);

  const value = useMemo<WsApi>(() => ({ events, status, clearEvents }), [events, status, clearEvents]);

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

export function useWebSocket(): WsApi {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useWebSocket требует <WebSocketProvider> выше по дереву');
  return ctx;
}
