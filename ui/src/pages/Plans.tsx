import { useState, useEffect, useCallback, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { awaitingPlans, type PlanItem } from './planStatus';
import type { IntakeList } from './intakeStatus';
import { approvePlan, rejectPlan } from './actions';

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 16, boxShadow: 'var(--shadow)', marginBottom: 12,
};
const btn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
  cursor: 'pointer', fontSize: 14, marginRight: 8,
};

export function PlansContent() {
  const [items, setItems] = useState<PlanItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [planHtml, setPlanHtml] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const fetchList = useCallback(() => {
    fetch('/api/intake')
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((d: IntakeList) => setItems(awaitingPlans(d.items || [])))
      .catch(() => setItems([]));
  }, []);
  useEffect(() => { fetchList(); }, [fetchList]);

  const activeId = useRef<string | null>(null);

  const openPlan = useCallback((id: string) => {
    if (openId === id) { setOpenId(null); activeId.current = null; return; }
    setOpenId(id);
    activeId.current = id;
    setPlanHtml('');
    fetch(`/api/intake/${id}/plan`)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error('no plan'))))
      .then((md) => {
        if (activeId.current !== id) return; // a newer card was opened; ignore
        const html = DOMPurify.sanitize(marked.parse(md, { async: false }), {
          ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li',
            'code', 'pre', 'strong', 'em', 'del', 'a', 'blockquote', 'hr', 'br',
            'table', 'thead', 'tbody', 'tr', 'th', 'td'],
          ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
        });
        setPlanHtml(html);
      })
      .catch(() => { if (activeId.current === id) setPlanHtml('<p>План недоступен.</p>'); });
  }, [openId]);

  const doAction = useCallback(async () => {
    if (!confirm) return;
    setBusy(true); setMsg(null);
    try {
      if (confirm.action === 'approve') await approvePlan(confirm.id);
      else await rejectPlan(confirm.id, reason);
      setConfirm(null); setReason(''); setOpenId(null);
      fetchList();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [confirm, reason, fetchList]);

  return (
    <div>
      {msg && <div style={{ ...card, color: 'crimson' }}>{msg}</div>}
      {items.length === 0 && <div style={card}>Нет планов, ожидающих одобрения.</div>}
      {items.map((it) => (
        <div key={it.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <strong>{it.raw_text.split('\n')[0]}</strong>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {it.target_project || '—'} · {it.created_at.slice(0, 10)}
              </div>
            </div>
            <button style={btn} onClick={() => openPlan(it.id)}>
              {openId === it.id ? 'Скрыть' : 'План'}
            </button>
          </div>
          {openId === it.id && (
            <>
              <div
                style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}
                dangerouslySetInnerHTML={{ __html: planHtml || '<p style="color:var(--text-secondary)">Загрузка…</p>' }}
              />
              <div style={{ marginTop: 12 }}>
                <button
                  style={{ ...btn, background: 'var(--accent)', color: '#fff' }}
                  onClick={() => setConfirm({ id: it.id, action: 'approve' })}
                >
                  Одобрить
                </button>
                <button style={btn} onClick={() => setConfirm({ id: it.id, action: 'reject' })}>
                  Отклонить
                </button>
              </div>
            </>
          )}
        </div>
      ))}

      {confirm && (
        <div
          role="dialog"
          aria-modal={true}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div style={{ ...card, maxWidth: 420, marginBottom: 0 }}>
            <p style={{ marginTop: 0 }}>
              {confirm.action === 'approve'
                ? 'Одобрить план? Локальный CC начнёт исполнение.'
                : 'Отклонить план?'}
            </p>
            {confirm.action === 'reject' && (
              <textarea
                placeholder="Причина (что переделать)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={{ width: '100%', minHeight: 80, marginBottom: 8 }}
              />
            )}
            <div>
              <button style={{ ...btn, background: 'var(--accent)', color: '#fff' }} disabled={busy} onClick={doAction}>
                {busy ? '…' : 'Подтвердить'}
              </button>
              <button style={btn} disabled={busy} onClick={() => { setConfirm(null); setReason(''); setMsg(null); }}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
