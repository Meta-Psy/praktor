async function post(path: string, body?: unknown): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `request failed (${res.status})`);
  }
}

export function approve(
  key: string,
  tier: "trivial" | "all",
  issue: number,
): Promise<void> {
  return post(`/api/projects/${key}/approve`, { tier, issue });
}

export function mergePR(key: string, n: number): Promise<void> {
  return post(`/api/projects/${key}/pulls/${n}/merge`);
}

export function deploy(key: string): Promise<void> {
  return post(`/api/projects/${key}/deploy`);
}

export function approvePlan(id: string): Promise<void> {
  return post(`/api/intake/${id}/approve`);
}

export function rejectPlan(id: string, reason: string): Promise<void> {
  return post(`/api/intake/${id}/reject`, { reason });
}
