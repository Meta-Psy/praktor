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
  const itemsRef = useRef<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: number) => {
    timers.current.delete(id);
    itemsRef.current = itemsRef.current.filter((t) => t.id !== id);
    setItems(itemsRef.current);
  }, []);

  const push = useCallback((kind: ToastItem['kind'], text: string) => {
    // Повтор того же тоста не дублируется, но продлевает время показа
    const existing = itemsRef.current.find((t) => t.kind === kind && t.text === text);
    if (existing) {
      clearTimeout(timers.current.get(existing.id));
      timers.current.set(existing.id, setTimeout(() => remove(existing.id), TOAST_TTL_MS[kind]));
      return;
    }
    const id = nextId.current++;
    itemsRef.current = [...itemsRef.current, { id, kind, text }];
    setItems(itemsRef.current);
    timers.current.set(id, setTimeout(() => remove(id), TOAST_TTL_MS[kind]));
  }, [remove]);

  useEffect(() => {
    const map = timers.current;
    return () => { map.forEach(clearTimeout); };
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
