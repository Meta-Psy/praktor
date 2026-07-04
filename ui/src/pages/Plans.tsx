import { useState, useEffect, useCallback, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { awaitingPlans, type PlanItem } from './planStatus';
import type { IntakeList } from './intakeStatus';
import { approvePlan, rejectPlan } from './actions';
import { Button, Card, ConfirmDialog, EmptyState, Skeleton, Textarea, useToast } from '../components/ui';

export function PlansContent() {
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [planHtml, setPlanHtml] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

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
    setBusy(true);
    try {
      if (confirm.action === 'approve') await approvePlan(confirm.id);
      else await rejectPlan(confirm.id, reason);
      setConfirm(null); setReason(''); setOpenId(null);
      fetchList();
    } catch (e) {
      toast.error(`Не удалось выполнить: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [confirm, reason, fetchList, toast]);

  const list = items ?? [];

  return (
    <div>
      {items === null && <Skeleton lines={3} />}
      {items !== null && list.length === 0 && (
        <EmptyState
          title="Нет планов, ожидающих одобрения"
          hint="Когда агент подготовит план по задаче из Входящих, он появится здесь на подпись."
        />
      )}
      {list.map((it) => (
        <Card key={it.id} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <strong>{it.raw_text.split('\n')[0]}</strong>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {it.target_project || '—'} · {it.created_at.slice(0, 10)}
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => openPlan(it.id)}>
              {openId === it.id ? 'Скрыть' : 'План'}
            </Button>
          </div>
          {openId === it.id && (
            <>
              <div
                style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}
                dangerouslySetInnerHTML={{ __html: planHtml || '<p style="color:var(--text-secondary)">Загрузка…</p>' }}
              />
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <Button onClick={() => setConfirm({ id: it.id, action: 'approve' })}>Одобрить</Button>
                <Button variant="secondary" onClick={() => setConfirm({ id: it.id, action: 'reject' })}>Отклонить</Button>
              </div>
            </>
          )}
        </Card>
      ))}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.action === 'approve' ? 'Одобрить план?' : 'Отклонить план?'}
        message={confirm?.action === 'approve'
          ? 'Локальный CC начнёт исполнение.'
          : (
            <Textarea
              placeholder="Причина (что переделать)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        confirmLabel={confirm?.action === 'approve' ? 'Одобрить' : 'Отклонить'}
        danger={confirm?.action === 'reject'}
        busy={busy}
        onConfirm={doAction}
        onCancel={() => { setConfirm(null); setReason(''); }}
      />
    </div>
  );
}
