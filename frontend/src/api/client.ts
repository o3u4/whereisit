/* whereisit · thin JSON client for the FastAPI backend.
 * Every response is unwrapped from the {"v":1,"data":…} envelope; non-2xx surfaces
 * the {"error": msg} body as an ApiError. All id bridge points (backend int <-> UI
 * string) and status-vocabulary adaptation live here + in lib/tree.spaceToDir. */

import type { Item, ItemStatus } from '../lib/types';
import { spaceToDir } from '../lib/tree';
import type { DirNode } from '../lib/types';
import type { LotDTO, SpaceNodeDTO } from './types';

const BASE = '/api';

export class ApiError extends Error {}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('无法连接后端');
  }
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json && typeof json === 'object' && 'error' in json && typeof json.error === 'string')
      ? json.error
      : `请求失败 (${res.status})`;
    throw new ApiError(msg);
  }
  const data = (json as { data?: T } | null)?.data;
  if (data === undefined) throw new ApiError('后端响应缺少 data');
  return data;
}

function lotToItem(lot: LotDTO): Item {
  return {
    slug: String(lot.lot_id),
    name: lot.name,
    alias: lot.alias ?? '',
    qty: lot.qty,
    unit: lot.unit ?? '',
    cat: lot.category ?? '',
    status: lot.status as ItemStatus,
    attrs: (lot.attrs ?? []).map((a) => [a[0], a[1]] as [string, string]),
    spot: String(lot.space_id),
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
  qty: number;
  status: ItemStatus;
  space_id: number;
}

export async function registerItem(payload: RegisterPayload): Promise<{ item: Item; merged: boolean }> {
  const data = await request<{ lot: LotDTO; merged: boolean }>('POST', '/items/register', {
    name: payload.name,
    alias: payload.alias,
    category: payload.category,
    unit: payload.unit,
    qty: payload.qty,
    status: payload.status,
    space_id: payload.space_id,
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
