import { useState, useEffect, useCallback } from 'react';
import { Button, Card, PageHeader, Skeleton, Textarea, useToast } from '../components/ui';

export default function UserProfile() {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/user-profile');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setContent(data.content || '');
    } catch (err) {
      toast.error(`Не удалось загрузить досье: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/user-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Сохранено');
    } catch (err) {
      toast.error(`Не удалось сохранить: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Досье"
        subtitle="Личная информация, доступная всем агентам через USER.md"
        actions={<Button onClick={handleSave} busy={saving} disabled={loading}>Сохранить</Button>}
      />

      <Card>
        {loading ? (
          <Skeleton lines={6} />
        ) : (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            style={{ minHeight: 400, fontFamily: 'monospace', fontSize: 14, lineHeight: 1.6 }}
            placeholder="# User Profile&#10;&#10;## Name&#10;..."
          />
        )}
      </Card>
    </div>
  );
}
