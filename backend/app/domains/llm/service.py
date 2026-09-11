from __future__ import annotations

import base64
import json

from openai import OpenAI

_TREE_SYSTEM = """You are whereisit's catalog assistant. The user describes, and/or sends a
photo of, a place (a desk, a closet, a shelf, a room) and we will build a folder
tree beneath one root the user already chose. Respond with STRICT JSON only (no
prose, no fences):
{"nodes":[{"name": string, "children":[<same shape>], "items":[{"name": string,
  "alias": string|null, "category": string|null, "unit": string|null, "qty": int,
  "status": "present"|"consumed"|"lent"|null, "notes": string|null,
  "attrs":[["key","value"], ...]}]}]}
Rules:
- name: short folder names, prefer the user's language (Chinese if input is Chinese).
- Only include containers/items actually visible or clearly stated. Do NOT invent
  a top-level scene name — the root is chosen by the user.
- qty defaults to 1; status defaults to "present".
- Keep it tidy: at most a few levels, no empty items lists."""


def complete_json(
    base_url: str,
    api_key: str | None,
    model: str,
    text: str | None,
    image_bytes: bytes | None = None,
    system: str = _TREE_SYSTEM,
    max_tokens: int = 1800,
) -> dict | None:
    """Call an OpenAI-compatible multimodal model and return the parsed JSON object."""
    if not base_url:
        return None
    client = OpenAI(base_url=base_url, api_key=api_key or "sk-local")
    content: list[dict] = []
    if text and text.strip():
        content.append({"type": "text", "text": text.strip()})
    if image_bytes:
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{base64.b64encode(image_bytes).decode()}"},
            }
        )
    if not content:
        return None
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": content},
            ],
            max_tokens=max_tokens,
            temperature=0.2,
        )
        raw = (resp.choices[0].message.content or "").strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1]
            raw = raw.rsplit("```", 1)[0].strip()
        return json.loads(raw)
    except Exception:
        return None