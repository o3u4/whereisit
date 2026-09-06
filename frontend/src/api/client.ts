/* whereisit · thin JSON client for the FastAPI backend.
 * Every response is unwrapped from the {"v":1,"data":…} envelope; non-2xx surfaces
 * the {"error": msg} body as an ApiError. All id bridge points (backend int <-> UI
 * string) and status-vocabulary adaptation live here + in lib/tree.spaceToDir. */

import type { Category, Item, ItemStatus } from '../lib/types';
import { spaceToDir } from '../lib/tree';
import type { DirNode } from '../lib/types';
import type {
  CategoryDTO,
  DeleteResultDTO,
  LotDTO,
  SearchModeDTO,
  SearchResultDTO,
  SpaceHitDTO,
  SpaceNodeDTO,
} from './types';
import { getToken, useAuth } from '../stores/auth';

const BASE = '/api';

export class ApiError extends Error {}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  const headers: Record<string, string> =
    body === undefined ? {} : { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('无法连接后端');
  }
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      // surface the token gate (App.tsx listens)
      useAuth.getState().setUnauthorized(true);
    }
    const msg = (json && typeof json === 'object' && 'error' in json && typeof json.error === 'string')
      ? json.error
      : `请求失败 (${res.status})`;
    throw new ApiError(msg);
  }
  const data = (json as { data?: T } | null)?.data;
  if (data === undefined) throw new ApiError('后端响应缺少 data');
  return data;
}

/* ---- settings + access token + backup ------------------------------------- */
export interface SettingsDTO {
  lang: string;
  token_enabled: boolean;
  lan_url: string;
}

export async function fetchSettings(): Promise<SettingsDTO> {
  return request<SettingsDTO>('GET', '/settings');
}

export async function saveSettings(patch: { lang?: 'zh' | 'en'; token_enabled?: boolean }): Promise<SettingsDTO> {
  return request<SettingsDTO>('PUT', '/settings', patch);
}

export async function createAccessToken(): Promise<{ token: string }> {
  return request<{ token: string }>('POST', '/settings/token');
}

export async function revokeAccessToken(): Promise<{ revoked: boolean }> {
  return request<{ revoked: boolean }>('DELETE', '/settings/token');
}

/** full round-trippable backup object ({format, version, exported_at, data}) */
export async function exportData<T = Record<string, unknown>>(): Promise<T> {
  return request<T>('GET', '/export');
}

export async function importData<T = Record<string, unknown>>(
  payload: T,
): Promise<Record<string, number>> {
  return request<Record<string, number>>('POST', '/import?mode=merge', payload);
}

function lotToItem(lot: LotDTO): Item {
  return {
    slug: String(lot.lot_id),
    defId: lot.def_id,
    name: lot.name,
    alias: lot.alias ?? '',
    qty: lot.qty,
    unit: lot.unit ?? '',
    cat: lot.category ?? '',
    status: lot.status as ItemStatus,
    attrs: (lot.attrs ?? []).map((a) => [a[0], a[1]] as [string, string]),
    spot: String(lot.space_id),
    notes: lot.notes ?? '',
  };
}

export async function fetchTree(): Promise<DirNode[]> {
  const data = await request<SpaceNodeDTO[]>('GET', '/spaces/tree');
  return data.map(spaceToDir);
}

export async function fetchItems(): Promise<Item[]> {
  const data = await request<LotDTO[]>('GET', '/items');
  return data.map(lotToItem);
}

export interface RegisterPayload {
  name: string;
  alias?: string;
  category?: string;
  unit?: string;
  notes?: string;
  qty: number;
  status: ItemStatus;
  space_id: number;
  /** rebuild a separate lot even when a same-def present lot already sits there */
  no_merge?: boolean;
}

export async function registerItem(payload: RegisterPayload): Promise<{ item: Item; merged: boolean }> {
  const data = await request<{ lot: LotDTO; merged: boolean }>('POST', '/items/register', {
    name: payload.name,
    alias: payload.alias,
    category: payload.category,
    unit: payload.unit,
    notes: payload.notes,
    qty: payload.qty,
    status: payload.status,
    space_id: payload.space_id,
    no_merge: payload.no_merge ?? false,
  });
  return { item: lotToItem(data.lot), merged: data.merged };
}

export async function moveSpace(spaceId: number, intoId: number): Promise<void> {
  await request('POST', `/spaces/${spaceId}/move`, { parent_id: intoId });
}

export interface PatchFields {
  qty?: number;
  status?: ItemStatus;
  space_id?: number;
  notes?: string;
}

export async function patchLot(
  lotId: number,
  patch: PatchFields,
): Promise<{ item: Item; merged: boolean; removedId: string | null }> {
  const data = await request<{ lot: LotDTO; merged: boolean; removed_id: number | null }>(
    'PATCH',
    `/items/lots/${lotId}`,
    patch,
  );
  return {
    item: lotToItem(data.lot),
    merged: data.merged,
    removedId: data.removed_id === null ? null : String(data.removed_id),
  };
}

export interface SearchParams {
  q: string;
  mode?: SearchModeDTO;
  scope_space_id?: number;
  category_id?: number;
}

export interface SearchResult {
  mode: SearchModeDTO;
  items: Item[];
  spaces: SpaceHitDTO[];
}

export async function deleteLot(lotId: number): Promise<{ removed_id: number }> {
  const data = await request<DeleteResultDTO>('DELETE', `/items/lots/${lotId}`);
  return { removed_id: data.removed_id };
}

function catFromDTO(d: CategoryDTO): Category {
  return { id: d.id, name: d.name, itemCount: d.item_count };
}

export async function fetchCategories(): Promise<Category[]> {
  const data = await request<CategoryDTO[]>('GET', '/categories');
  return data.map(catFromDTO);
}

export async function createCategory(name: string): Promise<Category> {
  const data = await request<CategoryDTO>('POST', '/categories', { name });
  return catFromDTO(data);
}

export async function renameCategory(id: number, name: string): Promise<Category> {
  const data = await request<CategoryDTO>('PATCH', `/categories/${id}`, { name });
  return catFromDTO(data);
}

export async function deleteCategory(id: number, intoId?: number): Promise<{ removed_id: number }> {
  const path = `/categories/${id}${intoId ? `?into_id=${intoId}` : ''}`;
  const data = await request<DeleteResultDTO>('DELETE', path);
  return { removed_id: data.removed_id };
}

export interface MergeDefsResult {
  kept_id: number;
  removed_id: number;
  lots_moved: number;
}

export async function mergeDefs(keepId: number, fromId: number): Promise<MergeDefsResult> {
  return request<MergeDefsResult>('POST', `/items/defs/${keepId}/merge`, { from_id: fromId });
}

export async function patchDefCategory(
  defId: number,
  categoryId: number,
): Promise<{ def_id: number; category_id: number }> {
  return request('PATCH', `/items/defs/${defId}`, { category_id: categoryId });
}

export async function setDefAttr(defId: number, key: string, value: string): Promise<void> {
  await request('PUT', `/items/defs/${defId}/attrs`, { key, value });
}

export async function deleteDefAttr(defId: number, key: string): Promise<void> {
  const params = new URLSearchParams({ key });
  await request('DELETE', `/items/defs/${defId}/attrs?${params.toString()}`);
}

export async function search(p: SearchParams): Promise<SearchResult> {
  const params = new URLSearchParams({ q: p.q });
  if (p.mode) params.set('mode', p.mode);
  if (p.scope_space_id != null) params.set('scope_space_id', String(p.scope_space_id));
  if (p.category_id != null) params.set('category_id', String(p.category_id));
  const data = await request<SearchResultDTO>('GET', `/search?${params.toString()}`);
  return { mode: data.mode, items: data.items.map(lotToItem), spaces: data.spaces };
}
