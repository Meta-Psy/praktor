import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import './Toast.css';

type ToastItem = { id: number; kind: 'success' | 'error'; text: string };

type ToastApi = {
  success: (text: string) => void;
  error: (text: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const TOAST_TTL_MS: Record<ToastItem['kind'], number> = { success: 4000, error: 8000 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: ToastItem['kind'], text: string) => {
    const id = nextId.current++;
    setItems((prev) =>
      prev.some((t) => t.kind === kind && t.text === text) ? prev : [...prev, { id, kind, text }]
    );
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), TOAST_TTL_MS[kind]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (text) => push('success', text),
      error: (text) => push('error', text),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="ui-toasts" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className={`ui-toast ui-toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
              {t.text}
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast требует <ToastProvider> выше по дереву');
  return ctx;
}
