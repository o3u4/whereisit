/* whereisit · load a per-entity preview image as an object URL (fetched as a
 * Blob so the Authorization header stays on the request). Bump `nonce` after an
 * upload/delete to force a refetch. */

import { useEffect, useState } from 'react';
import { fetchMediaBlob, type MediaEntity } from '../api/client';

export function useMedia(
  type: MediaEntity,
  id: number | null,
  active = true,
  nonce = 0,
): { url: string | null; hasImage: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [hasImage, setHasImage] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    if (!active || id == null) {
      setUrl(null);
      setHasImage(false);
      return undefined;
    }
    fetchMediaBlob(type, id)
      .then((blob) => {
        if (cancelled) return;
        if (blob && blob.size > 0) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
          setHasImage(true);
        } else {
          setHasImage(false);
        }
      })
      .catch(() => {
        if (!cancelled) setHasImage(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [type, id, active, nonce]);

  return { url, hasImage };
}