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
  username: string | null;
  is_admin: boolean;
  registration: 'auto' | 'manual';
  theme: 'apple' | 'flat' | 'pixel';
  llm_configured: boolean;
  llm_has_key: boolean;
  llm_base_url: string;
  llm_model: string;
}

export async function fetchSettings(): Promise<SettingsDTO> {
  return request<SettingsDTO>('GET', '/settings');
}

export async function saveSettings(patch: {
  lang?: 'zh' | 'en';
  token_enabled?: boolean;
  registration?: 'auto' | 'manual';
  theme?: 'apple' | 'flat' | 'pixel';
  llm_base_url?: string;
  llm_model?: string;
  llm_api_key?: string; // '' clears; omitted keeps current
}): Promise<SettingsDTO> {
  return request<SettingsDTO>('PUT', '/settings', patch);
}

/** self-signup mode the gate should show (public, no token needed) */
export async function fetchRegisterPolicy(): Promise<'auto' | 'manual'> {
  const data = await request<{ mode: 'auto' | 'manual' }>('GET', '/register-policy');
  return data.mode;
}

export async function registerSelf(username: string): Promise<CreatedUser> {
  return request<CreatedUser>('POST', '/register', { username });
}

/** ensure a token exists (never rotates) and return / re-show it */
export async function createAccessToken(): Promise<{ token: string }> {
  return request<{ token: string }>('POST', '/settings/token');
}

/** re-fetch the current token (to re-show / re-download) */
export async function fetchAccessToken(): Promise<{ token: string }> {
  return request<{ token: string }>('GET', '/settings/token');
}

/** explicitly rotate to a brand-new token */
export async function replaceAccessToken(): Promise<{ token: string }> {
  return request<{ token: string }>('POST', '/settings/token/replace');
}

export async function revokeAccessToken(): Promise<{ revoked: boolean }> {
  return request<{ revoked: boolean }>('DELETE', '/settings/token');
}

/* ---- user management (admin, per-user tokens + isolation) ----------------- */
export interface AdminUser {
  id: number;
  username: string;
  is_admin: boolean;
}

export interface CreatedUser {
  id: number;
  username: string;
  token: string;
}

export async function fetchUsers(): Promise<AdminUser[]> {
  const data = await request<{ users: AdminUser[] }>('GET', '/admin/users');
  return data.users;
}

export async function createUser(username: string): Promise<CreatedUser> {
  return request<CreatedUser>('POST', '/admin/users', { username });
}

export async function replaceUserToken(userId: number): Promise<{ token: string }> {
  return request<{ token: string }>('POST', `/admin/users/${userId}/token/replace`);
}

export async function revokeUserToken(userId: number): Promise<{ revoked: boolean }> {
  return request<{ revoked: boolean }>('DELETE', `/admin/users/${userId}/token`);
}

export async function deleteUser(userId: number): Promise<{ removed_id: number }> {
  return request<{ removed_id: number }>('DELETE', `/admin/users/${userId}`);
}

/* ---- preview images (per entity, on-disk, owner-scoped) ------------------- */
export type MediaEntity = 'space' | 'lot';

function mediaUrl(type: MediaEntity, id: number) {
  return `${BASE}/media?entity_type=${type}&entity_id=${id}`;
}

async function mediaFail(res: Response) {
  if (res.status === 401) useAuth.getState().setUnauthorized(true);
  const json: unknown = await res.json().catch(() => ({}));
  const msg = json && typeof json === 'object' && 'error' in json && typeof json.error === 'string'
    ? json.error
    : `请求失败 (${res.status})`;
  throw new ApiError(msg);
}

async function mediaAuth(): Promise<Record<string, string>> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function uploadMedia(type: MediaEntity, id: number, file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(mediaUrl(type, id), { method: 'PUT', headers: await mediaAuth(), body: form });
  if (!res.ok) await mediaFail(res);
}

export async function deleteMedia(type: MediaEntity, id: number): Promise<boolean> {
  const res = await fetch(mediaUrl(type, id), { method: 'DELETE', headers: await mediaAuth() });
  if (!res.ok) await mediaFail(res);
  const data = (await res.json().catch(() => ({}))) as { data?: { removed?: boolean } };
  return data.data?.removed ?? false;
}

/** fetch the image bytes as a blob (Authorization stays on the header). */
export async function fetchMediaBlob(type: MediaEntity, id: number): Promise<Blob | null> {
  const res = await fetch(mediaUrl(type, id), { headers: await mediaAuth() });
  if (res.status === 404) return null;
  if (!res.ok) await mediaFail(res);
  return res.blob();
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

export interface SpaceOut {
  id: number;
  parent_id: number | null;
  name: string;
  type_tag: string;
  ord: number;
}

export async function createSpace(p: {
  name: string;
  parent_id?: number | null;
  type_tag?: string;
  ord?: number;
}): Promise<SpaceOut> {
  return request<SpaceOut>('POST', '/spaces', {
    name: p.name,
    parent_id: p.parent_id ?? null,
    type_tag: p.type_tag ?? 'generic',
    ord: p.ord ?? 0,
  });
}

/** resolve a nested path (root-first), creating missing segments (mkdir -p).
 * type_tag applies to the leaf only when it is created. */
export async function ensurePath(names: string[], typeTag?: string): Promise<{ id: number }> {
  return request<{ id: number }>('POST', '/spaces/ensure-path', {
    names,
    type_tag: typeTag,
  });
}

/** delete a space subtree (cascade) */
export async function deleteSpace(spaceId: number): Promise<{ removed_ids: number[] }> {
  const data = await request<{ removed_ids: number[] }>('DELETE', `/spaces/${spaceId}`);
  return data;
}

/** turn a leaf space into an item of the same name at its parent (lots move up) */
export async function spaceToItem(
  spaceId: number,
): Promise<{ merged: boolean; lots_moved: number; removed_id: number }> {
  return request('POST', `/spaces/${spaceId}/to-item`);
}

/** patch a space's declarative layout_json (e.g. { group: "家/公司", ... }) */
export async function updateSpaceLayout(
  spaceId: number,
  layout: Record<string, unknown>,
): Promise<SpaceOut> {
  return request<SpaceOut>('PATCH', `/spaces/${spaceId}`, { layout_json: JSON.stringify(layout) });
}

/* ---- LLM: recognize a text/photo into a tree, then bulk-build it ------------ */
export interface TreeItem {
  name: string;
  alias?: string;
  category?: string;
  unit?: string;
  qty?: number;
  status?: ItemStatus;
  notes?: string;
  attrs?: [string, string][];
}
export interface TreeNode {
  name: string;
  type_tag?: string;
  children?: TreeNode[];
  items?: TreeItem[];
}

/** ask the multimodal model to turn a description / photo into a category tree */
export async function recognizeTree(
  text?: string,
  imageBase64?: string,
): Promise<{ nodes: TreeNode[] }> {
  return request<{ nodes: TreeNode[] }>('POST', '/llm/recognize', {
    text,
    image_base64: imageBase64,
  });
}

/** bulk-create the tree under a chosen parent (find-or-create, idempotent) */
export async function buildTree(
  parentId: number | null,
  nodes: TreeNode[],
): Promise<{ created: { spaces: number; items: number } }> {
  return request<{ created: { spaces: number; items: number } }>('POST', '/spaces/build-tree', {
    parent_id: parentId,
    nodes,
  });
}

/* ---- LLM agent: plan → approve → apply (four coarse tools, path-addressed) -- */
export type PlanTool = 'create' | 'update' | 'remove';
export interface PlanStep {
  tool: PlanTool;
  args: Record<string, unknown>;
}
export interface PlanLine {
  ok: boolean;
  text: string;
}
export interface ApplyResult {
  index: number;
  tool: PlanTool;
  lines: PlanLine[];
}

/** ask the model to draft an execution plan (reads the tree, mutates nothing).
 * Pass `revision` + the current plan to have it re-draft only what you changed. */
export async function agentPlan(
  message?: string,
  attachments?: { image_base64?: string }[],
  opts?: { revision?: string; prev_steps?: PlanStep[] },
): Promise<{ steps: PlanStep[]; reply: string }> {
  return request<{ steps: PlanStep[]; reply: string }>('POST', '/llm/agent/plan', {
    message,
    attachments,
    revision: opts?.revision,
    prev_steps: opts?.prev_steps,
  });
}

/** run an approved plan on the server (sequential, one transaction, undoable) */
export async function agentApply(
  plan: PlanStep[],
): Promise<{ results: ApplyResult[]; undo_id: number | null }> {
  return request<{ results: ApplyResult[]; undo_id: number | null }>('POST', '/llm/agent/apply', {
    plan,
  });
}

export async function agentUndo(undoId: number): Promise<{ restored: Record<string, number> }> {
  return request<{ restored: Record<string, number> }>('POST', '/llm/agent/undo', { undo_id: undoId });
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

export async function renameDef(defId: number, name: string): Promise<{ def_id: number; name: string }> {
  return request('PATCH', `/items/defs/${defId}`, { name });
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
