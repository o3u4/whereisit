import type { SpaceInput, SpaceNode } from './types'

interface Envelope<T> {
  v: number
  data: T
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let message = res.statusText
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      /* non-json error body */
    }
    throw new Error(message)
  }
  const envelope = (await res.json()) as Envelope<T>
  return envelope.data
}

export const api = {
  tree: () => request<SpaceNode[]>('/spaces/tree'),
  createSpace: (input: SpaceInput) =>
    request<SpaceNode>('/spaces', { method: 'POST', body: JSON.stringify(input) }),
  moveSpace: (id: number, parentId: number | null, index?: number) =>
    request<SpaceNode>(`/spaces/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ parent_id: parentId, index }),
    }),
  deleteSpace: (id: number, mode: 'cascade' | 'move_children') =>
    request<{ removed_ids: number[] }>(`/spaces/${id}?mode=${mode}`, { method: 'DELETE' }),
}
