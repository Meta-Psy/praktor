import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWebSocket } from '../hooks/useWebSocket';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, PageHeader, Skeleton, Textarea, useToast,
} from '../components/ui';
import { approve, approvePlan, mergePR, rejectPlan, runTaskNow } from './actions';
import {
  buildDecisions, buildFeed, runningSwarms,
  type DecisionCard, type StatusData, type SwarmRunItem, type TaskItem,
} from './dashboardStatus';
import type { IntakeItem, IntakeList } from './intakeStatus';
import type { ProjectStatus } from './projectStatus';

type Pending =
  | { kind: 'plan-approve'; id: string; title: string }
  | { kind: 'plan-reject'; id: string; title: string }
  | { kind: 'pr-merge'; project: string; repo: string; number: number }
  | { kind: 'audit-approve'; project: string; repo: string; number: number; tier: 'trivial' | 'all' };

const chipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 999, padding: '4px 14px', fontSize: 13.5, color: 'var(--text-secondary)',
};

const colTitleStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
  fontSize: 12, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.07em', color: 'var(--text-tertiary)',
};

const metaStyle: React.CSSProperties = { fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 };

function DecisionCardView({ card, onAct, onRetry }: {
  card: DecisionCard;
  onAct: (p: Pending) => void;
  onRetry: (taskId: string) => void;
}) {
  const navigate = useNavigate();

  if (card.kind === 'plan') {
    return (
      <Card style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Badge tone="accent">План</Badge>
          <Link to="/intake?tab=plans" style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
            {card.title}
          </Link>
        </div>
        <div style={metaStyle}>{card.project} · поставлен {card.created}</div>
        {card.excerpt && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6, borderLeft: '2px solid var(--border)', paddingLeft: 9, fontStyle: 'italic' }}>
            {card.excerpt}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <Button size="sm" onClick={() => onAct({ kind: 'plan-approve', id: card.id, title: card.title })}>Подписать</Button>
          <Button size="sm" variant="secondary" onClick={() => navigate('/intake?tab=plans')}>Читать план</Button>
          <Button size="sm" variant="danger" onClick={() => onAct({ kind: 'plan-reject', id: card.id, title: card.title })}>Отклонить</Button>
        </div>
      </Card>
    );
  }

  if (card.kind === 'pr') {
    return (
      <Card style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Badge tone="ok">PR</Badge>
          <a href={card.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
            #{card.number} {card.title}
          </a>
        </div>
        <div style={metaStyle}>{card.repo} · CI: {card.ci}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <Button size="sm" onClick={() => onAct({ kind: 'pr-merge', project: card.project, repo: card.repo, number: card.number })}>Merge</Button>
          <Button size="sm" variant="secondary" onClick={() => window.open(card.url, '_blank', 'noopener')}>На GitHub</Button>
        </div>
      </Card>
    );
  }

  if (card.kind === 'audit') {
    return (
      <Card style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Badge tone="warn">Аудит</Badge>
          <a href={card.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
            #{card.number} {card.title}
          </a>
        </div>
        <div style={metaStyle}>{card.repo}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <Button size="sm" variant="secondary" onClick={() => onAct({ kind: 'audit-approve', project: card.project, repo: card.repo, number: card.number, tier: 'trivial' })}>
            Approve trivial
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onAct({ kind: 'audit-approve', project: card.project, repo: card.repo, number: card.number, tier: 'all' })}>
            Approve all
          </Button>
        </div>
      </Card>
    );
  }

  // Явный guard вместо безусловного return: новый kind в DecisionCard не должен
  // молча рендериться карточкой сбоя с чужими действиями
  if (card.kind !== 'failure') return null;

  return (
    <Card style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Badge tone="danger">Сбой</Badge>
        <Link to="/tasks" style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
          Дежурство «{card.name}» упало
        </Link>
      </div>
      <div style={metaStyle}>
        {card.lastRun && <>последний запуск {card.lastRun} · </>}агент {card.agent}
      </div>
      {card.error && (
        <div style={{ fontSize: 13, color: 'var(--red-light)', marginTop: 6, borderLeft: '2px solid var(--red-muted)', paddingLeft: 9 }}>
          {card.error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <Button size="sm" variant="secondary" onClick={() => onRetry(card.taskId)}>Повторить сейчас</Button>
        <Button size="sm" variant="secondary" onClick={() => navigate('/tasks')}>К дежурствам</Button>
      </div>
    </Card>
  );
}

function Dashboard() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [projects, setProjects] = useState<ProjectStatus[] | null>(null);
  const [intake, setIntake] = useState<IntakeItem[] | null>(null);
  const [swarms, setSwarms] = useState<SwarmRunItem[] | null>(null);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [failedSources, setFailedSources] = useState<string[]>([]);

  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { events } = useWebSocket();

  // Перекрывающиеся циклы опроса (интервал + WS-дебаунс): применяем только
  // результат последнего запущенного, иначе устаревший ответ затрёт свежий
  const epochRef = useRef(0);

  const fetchAll = useCallback(async () => {
    const epoch = ++epochRef.current;
    const get = async (url: string): Promise<unknown> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    };
    const [st, ts, pr, ik, sw, ag] = await Promise.allSettled([
      get('/api/status'), get('/api/tasks'), get('/api/projects'),
      get('/api/intake'), get('/api/swarms'), get('/api/agents/definitions'),
    ]);
    if (epoch !== epochRef.current) return;
    const failed: string[] = [];
    if (st.status === 'fulfilled') setStatus(st.value as StatusData); else failed.push('статус');
    if (ts.status === 'fulfilled') setTasks(Array.isArray(ts.value) ? ts.value as TaskItem[] : []); else failed.push('дежурства');
    if (pr.status === 'fulfilled') setProjects(Array.isArray(pr.value) ? pr.value as ProjectStatus[] : []); else failed.push('операции');
    if (ik.status === 'fulfilled') setIntake((ik.value as IntakeList).items || []); else failed.push('приёмная');
    if (sw.status === 'fulfilled') setSwarms(Array.isArray(sw.value) ? sw.value as SwarmRunItem[] : []); else failed.push('отряды');
    if (ag.status === 'fulfilled') {
      const defs = ag.value as { id: string; name?: string }[];
      setAgentNames(Object.fromEntries((Array.isArray(defs) ? defs : []).map((a) => [a.id, a.name || a.id])));
    } else {
      failed.push('агенты');
    }
    setFailedSources(failed);
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30000);
    return () => clearInterval(id);
  }, [fetchAll]);

  // Дозапрос по WS-событиям. Зависимость — сам массив events (ссылка меняется
  // на каждом сообщении); events.length сломается после переполнения буфера 500
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (events.length === 0) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchAll, 500);
    return () => clearTimeout(debounceRef.current);
  }, [events, fetchAll]);

  const decisions = useMemo(
    () => (tasks === null || projects === null || intake === null)
      ? null
      : buildDecisions(intake, projects, tasks),
    [intake, projects, tasks],
  );

  const feed = useMemo(
    () => buildFeed(status?.recent_messages ?? [], events, agentNames),
    [status, events, agentNames],
  );

  const confirmAction = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === 'plan-approve') await approvePlan(pending.id);
      else if (pending.kind === 'plan-reject') await rejectPlan(pending.id, reason);
      else if (pending.kind === 'pr-merge') await mergePR(pending.project, pending.number);
      else await approve(pending.project, pending.tier, pending.number);
      setPending(null);
      setReason('');
      fetchAll();
    } catch (e) {
      toast.error(`Не удалось выполнить: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [pending, reason, fetchAll, toast]);

  const retryTask = useCallback(async (taskId: string) => {
    try {
      await runTaskNow(taskId);
      toast.success('Дежурство поставлено на запуск');
      fetchAll();
    } catch (e) {
      toast.error(`Не удалось запустить: ${(e as Error).message}`);
    }
  }, [fetchAll, toast]);

  const healthy = failedSources.length === 0 && status?.status === 'ok';
  const dateStr = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  const confirmTitle =
    pending?.kind === 'plan-approve' ? 'Подписать план?' :
    pending?.kind === 'plan-reject' ? 'Отклонить план?' :
    pending?.kind === 'pr-merge' ? 'Merge PR?' : 'Approve audit-issue?';
  const confirmLabel =
    pending?.kind === 'plan-approve' ? 'Подписать' :
    pending?.kind === 'plan-reject' ? 'Отклонить' :
    pending?.kind === 'pr-merge' ? 'Merge' : 'Approve';
  const confirmMessage =
    pending?.kind === 'plan-approve' ? `«${pending.title}» — локальный CC начнёт исполнение.` :
    pending?.kind === 'plan-reject' ? (
      <Textarea
        placeholder="Причина (что переделать)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    ) :
    pending?.kind === 'pr-merge' ? `${pending.repo}#${pending.number}` :
    pending ? `${pending.repo}#${pending.number} · tier: ${pending.tier}` : '';

  return (
    <div>
      <PageHeader
        title="Обстановка"
        subtitle={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {dateStr}
            {status?.version && <> · {status.version}</>}
            <span style={{ color: healthy ? 'var(--green)' : 'var(--red)' }}>
              ● {healthy ? 'все системы в норме' : 'есть проблемы'}
            </span>
          </span>
        }
      />

      {failedSources.length > 0 && (
        <Card style={{ color: 'var(--red)', marginBottom: 16 }}>
          Не удалось загрузить: {failedSources.join(', ')}
        </Card>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        <span style={chipStyle}>
          <span style={{ color: (status?.active_agents ?? 0) > 0 ? 'var(--green)' : 'var(--text-muted)' }}>●</span>
          Агенты в работе: <b style={{ color: 'var(--text-primary)' }}>{status?.active_agents ?? 0}</b>
        </span>
        <span style={chipStyle}>
          Активные дежурства: <b style={{ color: 'var(--text-primary)' }}>{status?.pending_tasks ?? 0}</b>
        </span>
        <span style={chipStyle}>
          Отряды в работе: <b style={{ color: 'var(--text-primary)' }}>{runningSwarms(swarms ?? [])}</b>
        </span>
      </div>

      <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, alignItems: 'start' }}>
        <section>
          <div style={colTitleStyle}>
            Требует решения
            {decisions !== null && decisions.length > 0 && (
              <span style={{ background: 'var(--accent)', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '1px 8px' }}>
                {decisions.length}
              </span>
            )}
          </div>
          {decisions === null && <Skeleton lines={4} />}
          {decisions !== null && decisions.length === 0 && (
            <EmptyState
              title="Всё разобрано ✓"
              hint="Планы на подпись, PR к merge и сбои дежурств появятся здесь."
            />
          )}
          {(decisions ?? []).map((card) => (
            <DecisionCardView key={card.key} card={card} onAct={setPending} onRetry={retryTask} />
          ))}
        </section>

        <section>
          <div style={colTitleStyle}>Активность</div>
          <Card>
            {status === null && <Skeleton lines={4} />}
            {status !== null && feed.length === 0 && (
              <div style={{ color: 'var(--text-tertiary)', fontSize: 14, textAlign: 'center', padding: '12px 0' }}>
                Лента живая: события придут по WebSocket без обновления страницы
              </div>
            )}
            {feed.map((f) => (
              <div key={f.key} style={{ display: 'flex', gap: 10, padding: '7px 2px', borderBottom: '1px solid var(--border-subtle)', fontSize: 13.5 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  {f.time}
                </span>
                <span aria-hidden="true">{f.icon}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{f.text}</span>
              </div>
            ))}
          </Card>
        </section>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirmLabel}
        danger={pending?.kind === 'plan-reject'}
        busy={busy}
        onConfirm={confirmAction}
        onCancel={() => { setPending(null); setReason(''); }}
      />
    </div>
  );
}

export default Dashboard;
