import { useState, useEffect, useCallback } from 'react';
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

function Plans() {
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

  const openPlan = useCallback((id: string) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    setPlanHtml('');
    fetch(`/api/intake/${id}/plan`)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error('no plan'))))
      .then((md) => setPlanHtml(DOMPurify.sanitize(marked.parse(md) as string)))
      .catch(() => setPlanHtml('<p>План недоступен.</p>'));
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
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 16 }}>Планы на одобрение</h1>
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
                dangerouslySetInnerHTML={{ __html: planHtml }}
              />
              <div style={{ marginTop: 12 }}>
                <button
                  style={{ ...btn, background: 'var(--accent, #0F8B5C)', color: '#fff' }}
                  onClick={() => setConfirm({ id: it.id, action: 'approve' })}
                >
                  Approve
                </button>
                <button style={btn} onClick={() => setConfirm({ id: it.id, action: 'reject' })}>
                  Reject
                </button>
              </div>
            </>
          )}
        </div>
      ))}

      {confirm && (
        <div
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
              <button style={{ ...btn, background: 'var(--accent, #0F8B5C)', color: '#fff' }} disabled={busy} onClick={doAction}>
                {busy ? '…' : 'Подтвердить'}
              </button>
              <button style={btn} disabled={busy} onClick={() => { setConfirm(null); setReason(''); }}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Plans;
