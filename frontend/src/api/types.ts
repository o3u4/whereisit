/* whereisit · raw backend DTOs (mirror app/domains spaces + items wire shape).
 * Adapters in lib/tree.ts + api/client.ts convert these into src/lib/types.ts. */

export interface SpaceNodeDTO {
  id: number;
  parent_id: number | null;
  name: string;
  type_tag: string;
  ord: number;
  /** JSON string of {group?, tintA?, tintB?} for decorated scenes */
  layout_json: string | null;
  created_at: string;
  updated_at: string;
  children: SpaceNodeDTO[];
}

export type LotStatusDTO = 'present' | 'lent' | 'consumed';

/** a presence row (lot) joined with its def + category */
export interface LotDTO {
  lot_id: number;
  def_id: number;
  space_id: number;
  qty: number;
  status: LotStatusDTO;
  captured_at: string;
  created_at: string;
  updated_at: string;
  name: string;
  unit: string | null;
  /** category display label */
  category: string | null;
  /** first stored alias, '' when none */
  alias: string;
  attrs: [string, string][];
}

/** a space node hit returned by search (flat, any depth) */
export interface SpaceHitDTO {
  id: number;
  parent_id: number | null;
  name: string;
  type_tag: string;
}

export type SearchModeDTO = 'exact' | 'fuzzy' | 'category' | 'existence';

export interface SearchResultDTO {
  mode: SearchModeDTO;
  items: LotDTO[];
  spaces: SpaceHitDTO[];
}

export interface DeleteResultDTO {
  removed_id: number;
}
