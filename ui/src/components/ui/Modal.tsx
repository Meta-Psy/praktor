import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './Modal.css';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
};

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children }: ModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);

  // Scroll-lock: пока модалка открыта, body не прокручивается
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [open]);

  // Фокус на первый элемент; при закрытии — возврат туда, откуда открыли
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    boxRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => { prevFocus?.focus(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const box = boxRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && box) {
        // Фокус-ловушка: Tab циклится внутри модалки
        const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="ui-modal-backdrop" onClick={onClose}>
      <div
        className="ui-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={boxRef}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h3 className="ui-modal__title">{title}</h3>}
        {children}
      </div>
    </div>,
    document.body
  );
}
