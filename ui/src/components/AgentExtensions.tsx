import { useState, useEffect, useRef } from 'react';
import { Badge, Button, Card, Input, Skeleton, Tabs, TabPanel, Textarea, useToast } from './ui';

interface MCPServerConfig {
  type: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

interface MarketplaceConfig {
  source: string;
  name?: string;
}

interface PluginConfig {
  name: string;
  disabled?: boolean;
  requires?: string[];
}

interface SkillConfig {
  description: string;
  content: string;
  requires?: string[];
  files?: Record<string, string>; // relative path -> base64-encoded content
}

interface PluginStatus {
  name: string;
  enabled: boolean;
}

interface ExtensionStatus {
  marketplaces?: string[];
  plugins?: PluginStatus[];
}

interface AgentExtensions {
  mcp_servers?: Record<string, MCPServerConfig>;
  marketplaces?: MarketplaceConfig[];
  plugins?: PluginConfig[];
  skills?: Record<string, SkillConfig>;
  _status?: ExtensionStatus;
}

const itemBox: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
  background: 'var(--bg-input)',
};

const rowBox: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 12px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  marginBottom: 8,
  background: 'var(--bg-input)',
};

const mono: React.CSSProperties = { fontFamily: 'monospace' };

// MCP Servers tab
function MCPServersTab({
  servers,
  onChange,
}: {
  servers: Record<string, MCPServerConfig>;
  onChange: (servers: Record<string, MCPServerConfig>) => void;
}) {
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'' | 'stdio' | 'http'>('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editJSON, setEditJSON] = useState('');
  const toast = useToast();

  const addServer = () => {
    if (!newName.trim() || !newType) return;
    const base: MCPServerConfig =
      newType === 'stdio'
        ? { type: 'stdio', command: '', args: [], env: {} }
        : { type: newType, url: '', headers: {} };
    onChange({ ...servers, [newName.trim()]: base });
    setNewName('');
    setEditing(newName.trim());
    setEditJSON(JSON.stringify(base, null, 2));
  };

  const removeServer = (name: string) => {
    const next = { ...servers };
    delete next[name];
    onChange(next);
    if (editing === name) setEditing(null);
  };

  const saveEdit = () => {
    if (!editing) return;
    try {
      const parsed = JSON.parse(editJSON);
      onChange({ ...servers, [editing]: parsed });
      setEditing(null);
    } catch {
      toast.error('Некорректный JSON');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Имя сервера"
          style={{ width: 200 }}
          onKeyDown={(e) => e.key === 'Enter' && addServer()}
        />
        <select
          className="ui-input"
          value={newType}
          onChange={(e) => setNewType(e.target.value as 'stdio' | 'http')}
          style={{ width: 130 }}
        >
          <option value="" disabled>Транспорт</option>
          <option value="http">http</option>
          <option value="stdio">stdio</option>
        </select>
        <Button variant="secondary" size="sm" onClick={addServer}>Добавить</Button>
      </div>

      {Object.entries(servers).map(([name, srv]) => (
        <div key={name} style={itemBox}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <span style={{ fontWeight: 600 }}>{name}</span>
              <Badge tone="accent" style={{ marginLeft: 8 }}>{srv.type}</Badge>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditing(editing === name ? null : name);
                  setEditJSON(JSON.stringify(srv, null, 2));
                }}
              >
                {editing === name ? 'Отмена' : 'Изменить'}
              </Button>
              <Button variant="danger" size="sm" onClick={() => removeServer(name)}>Удалить</Button>
            </div>
          </div>
          {srv.type === 'stdio' && editing !== name && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', ...mono }}>
              {srv.command} {(srv.args || []).join(' ')}
            </div>
          )}
          {srv.type === 'http' && editing !== name && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', ...mono }}>{srv.url}</div>
          )}
          {editing === name && (
            <div style={{ marginTop: 8 }}>
              <Textarea
                value={editJSON}
                onChange={(e) => setEditJSON(e.target.value)}
                style={{ minHeight: 150, ...mono }}
              />
              <Button size="sm" style={{ marginTop: 8 }} onClick={saveEdit}>Применить</Button>
            </div>
          )}
        </div>
      ))}

      {Object.keys(servers).length === 0 && (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>MCP-серверы не настроены</div>
      )}
    </div>
  );
}

// Plugins tab (with marketplaces section)
function PluginsTab({
  marketplaces,
  plugins,
  status,
  onChangeMarketplaces,
  onChangePlugins,
}: {
  marketplaces: MarketplaceConfig[];
  plugins: PluginConfig[];
  status?: ExtensionStatus;
  onChangeMarketplaces: (marketplaces: MarketplaceConfig[]) => void;
  onChangePlugins: (plugins: PluginConfig[]) => void;
}) {
  const [newSource, setNewSource] = useState('');
  const [newPlugin, setNewPlugin] = useState('');

  const addMarketplace = () => {
    if (!newSource.trim()) return;
    onChangeMarketplaces([...marketplaces, { source: newSource.trim() }]);
    setNewSource('');
  };

  const removeMarketplace = (idx: number) => {
    onChangeMarketplaces(marketplaces.filter((_, i) => i !== idx));
  };

  const deriveName = (source: string): string => {
    return source.replace(/^https?:\/\//, '').replace(/[/.:]+/g, '-').replace(/-+$/, '');
  };

  const addPlugin = () => {
    if (!newPlugin.trim()) return;
    onChangePlugins([...plugins, { name: newPlugin.trim() }]);
    setNewPlugin('');
  };

  const removePlugin = (idx: number) => {
    onChangePlugins(plugins.filter((_, i) => i !== idx));
  };

  return (
    <div>
      <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>Маркетплейсы</h4>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        Добавьте источник (например, owner/repo) до установки его плагинов. Маркетплейс <code style={{ fontSize: 12 }}>claude-plugins-official</code> зарегистрирован по умолчанию.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Input
          value={newSource}
          onChange={(e) => setNewSource(e.target.value)}
          placeholder="owner/repo или https://example.com/marketplace.json"
          style={{ flex: 1 }}
          onKeyDown={(e) => e.key === 'Enter' && addMarketplace()}
        />
        <Button variant="secondary" size="sm" onClick={addMarketplace}>Добавить</Button>
      </div>

      {marketplaces.map((m, i) => {
        const isInstalled = status?.marketplaces?.some(
          (line) => line.includes(m.source) || line.includes(m.name || deriveName(m.source))
        );
        return (
          <div key={i} style={rowBox}>
            <div>
              <span style={{ fontSize: 14, ...mono }}>{m.source}</span>
              <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
                ({m.name || deriveName(m.source)})
              </span>
              {isInstalled && <Badge tone="ok" style={{ marginLeft: 8 }}>зарегистрирован</Badge>}
            </div>
            <Button variant="danger" size="sm" onClick={() => removeMarketplace(i)}>Удалить</Button>
          </div>
        );
      })}

      {marketplaces.length === 0 && (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 14, marginBottom: 16 }}>Дополнительных маркетплейсов нет</div>
      )}

      <h4 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 8px' }}>Плагины</h4>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Input
          value={newPlugin}
          onChange={(e) => setNewPlugin(e.target.value)}
          placeholder="plugin-name@marketplace"
          style={{ flex: 1 }}
          onKeyDown={(e) => e.key === 'Enter' && addPlugin()}
        />
        <Button variant="secondary" size="sm" onClick={addPlugin}>Добавить</Button>
      </div>

      {plugins.map((p, i) => {
        const pluginBase = p.name.split('@')[0];
        const pluginStatus = status?.plugins?.find(
          (ps) => ps?.name && (ps.name === p.name || ps.name === pluginBase || ps.name.startsWith(pluginBase + '@'))
        );
        return (
          <div key={i} style={{ ...rowBox, opacity: p.disabled ? 0.6 : 1 }}>
            <div>
              <span style={{ fontSize: 14, ...mono }}>{p.name}</span>
              {pluginStatus && !p.disabled && <Badge tone="ok" style={{ marginLeft: 8 }}>установлен</Badge>}
              {p.disabled && <Badge tone="warn" style={{ marginLeft: 8 }}>отключён</Badge>}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const updated = [...plugins];
                  updated[i] = { ...p, disabled: !p.disabled };
                  onChangePlugins(updated);
                }}
              >
                {p.disabled ? 'Включить' : 'Отключить'}
              </Button>
              <Button variant="danger" size="sm" onClick={() => removePlugin(i)}>Удалить</Button>
            </div>
          </div>
        );
      })}

      {plugins.length === 0 && (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>Плагины не настроены</div>
      )}
    </div>
  );
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Skills tab
function SkillsTab({
  skills,
  onChange,
}: {
  skills: Record<string, SkillConfig>;
  onChange: (skills: Record<string, SkillConfig>) => void;
}) {
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editFiles, setEditFiles] = useState<Record<string, string>>({});

  const addSkill = () => {
    if (!newName.trim()) return;
    const name = newName.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
    onChange({ ...skills, [name]: { description: '', content: '' } });
    setNewName('');
    setEditing(name);
    setEditDesc('');
    setEditContent('');
    setEditFiles({});
  };

  const removeSkill = (name: string) => {
    const next = { ...skills };
    delete next[name];
    onChange(next);
    if (editing === name) setEditing(null);
  };

  const saveEdit = () => {
    if (!editing) return;
    const skill: SkillConfig = {
      description: editDesc,
      content: editContent,
      ...(skills[editing]?.requires ? { requires: skills[editing].requires } : {}),
      ...(Object.keys(editFiles).length > 0 ? { files: editFiles } : {}),
    };
    onChange({ ...skills, [editing]: skill });
    setEditing(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList) return;
    const newFiles = { ...editFiles };
    Array.from(fileList).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const b64 = btoa(binary);
        newFiles[file.name] = b64;
        setEditFiles({ ...newFiles });
      };
      reader.readAsArrayBuffer(file);
    });
    e.target.value = '';
  };

  const removeFile = (path: string) => {
    const next = { ...editFiles };
    delete next[path];
    setEditFiles(next);
  };

  const renameFile = (oldPath: string, newPath: string) => {
    if (!newPath || newPath === oldPath) return;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(editFiles)) {
      next[k === oldPath ? newPath : k] = v;
    }
    setEditFiles(next);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Имя навыка (например, code-review)"
          style={{ width: 300 }}
          onKeyDown={(e) => e.key === 'Enter' && addSkill()}
        />
        <Button variant="secondary" size="sm" onClick={addSkill}>Добавить</Button>
      </div>

      {Object.entries(skills).map(([name, skill]) => (
        <div key={name} style={itemBox}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <span style={{ fontWeight: 600 }}>{name}</span>
              {skill.files && Object.keys(skill.files).length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
                  файлов: {Object.keys(skill.files).length}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (editing === name) {
                    setEditing(null);
                  } else {
                    setEditing(name);
                    setEditDesc(skill.description);
                    setEditContent(skill.content);
                    setEditFiles(skill.files ? { ...skill.files } : {});
                  }
                }}
              >
                {editing === name ? 'Отмена' : 'Изменить'}
              </Button>
              <Button variant="danger" size="sm" onClick={() => removeSkill(name)}>Удалить</Button>
            </div>
          </div>
          {editing !== name && skill.description && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{skill.description}</div>
          )}
          {editing === name && (
            <div style={{ marginTop: 8 }}>
              <Input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Описание"
                style={{ marginBottom: 8 }}
              />
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="Содержимое навыка (тело SKILL.md)"
                style={{ minHeight: 120, ...mono }}
              />

              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>Файлы</span>
                  <input
                    type="file"
                    multiple
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                    id={`skill-files-${name}`}
                  />
                  <label htmlFor={`skill-files-${name}`} className="ui-btn ui-btn--secondary ui-btn--sm" style={{ display: 'inline-flex' }}>
                    Загрузить файлы
                  </label>
                </div>

                {Object.entries(editFiles).map(([path, b64]) => {
                  const sizeBytes = Math.floor(b64.length * 3 / 4);
                  return (
                    <div
                      key={path}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 10px',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        marginBottom: 6,
                        background: 'var(--bg-card)',
                      }}
                    >
                      <Input
                        defaultValue={path}
                        onBlur={(e) => renameFile(path, e.target.value.trim())}
                        style={{ flex: 1, fontSize: 13, ...mono }}
                        title="Относительный путь файла (например, scripts/search.sh)"
                      />
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                        {formatFileSize(sizeBytes)}
                      </span>
                      <Button variant="danger" size="sm" onClick={() => removeFile(path)}>Удалить</Button>
                    </div>
                  );
                })}

                {Object.keys(editFiles).length === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                    Дополнительных файлов нет. Загрузите скрипты или конфиги, которые пойдут рядом со SKILL.md.
                  </div>
                )}
              </div>

              <Button size="sm" style={{ marginTop: 8 }} onClick={saveEdit}>Применить</Button>
            </div>
          )}
        </div>
      ))}

      {Object.keys(skills).length === 0 && (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>Навыки не настроены</div>
      )}
    </div>
  );
}

// Main component
export default function AgentExtensionsPanel({ agentId }: { agentId: string }) {
  const [ext, setExt] = useState<AgentExtensions>({});
  const [tab, setTab] = useState('mcp');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const loadEpoch = useRef(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const epoch = ++loadEpoch.current;
    fetch(`/api/agents/definitions/${agentId}/extensions`)
      .then((res) => res.json())
      .then((data) => { if (loadEpoch.current === epoch) setExt(data); })
      .catch((err) => {
        if (loadEpoch.current === epoch) {
          setExt({});
          setError(err.message);
        }
      })
      .finally(() => { if (loadEpoch.current === epoch) setLoading(false); });
  }, [agentId]);

  const save = () => {
    setSaving(true);
    setError(null);
    // Strip _status (read-only runtime data) before saving
    const { _status, ...payload } = ext;
    fetch(`/api/agents/definitions/${agentId}/extensions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        toast.success('Сохранено');
      })
      .catch((err) => toast.error(`Не удалось сохранить расширения: ${err.message}`))
      .finally(() => setSaving(false));
  };

  if (loading) {
    return (
      <Card>
        <Skeleton lines={3} />
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Расширения</h3>
          <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            MCP-серверы, плагины и навыки
          </p>
        </div>
        <Button onClick={save} busy={saving} disabled={error !== null}>Сохранить</Button>
      </div>

      {error && (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--red-muted)',
            border: '1px solid var(--red)',
            borderRadius: 6,
            color: 'var(--red)',
            fontSize: 14,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'mcp', label: 'MCP' },
          { id: 'plugins', label: 'Плагины' },
          { id: 'skills', label: 'Навыки' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <TabPanel id="mcp" active={tab === 'mcp'}>
        <MCPServersTab
          servers={ext.mcp_servers || {}}
          onChange={(servers) => setExt({ ...ext, mcp_servers: servers })}
        />
      </TabPanel>
      <TabPanel id="plugins" active={tab === 'plugins'}>
        <PluginsTab
          marketplaces={ext.marketplaces || []}
          plugins={ext.plugins || []}
          status={ext._status}
          onChangeMarketplaces={(marketplaces) => setExt({ ...ext, marketplaces })}
          onChangePlugins={(plugins) => setExt({ ...ext, plugins })}
        />
      </TabPanel>
      <TabPanel id="skills" active={tab === 'skills'}>
        <SkillsTab skills={ext.skills || {}} onChange={(skills) => setExt({ ...ext, skills })} />
      </TabPanel>
    </Card>
  );
}
