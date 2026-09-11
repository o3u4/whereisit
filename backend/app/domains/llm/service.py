from __future__ import annotations

import base64
import json
import time

import anthropic
import openai
from openai import OpenAI

_TREE_SYSTEM = """You are whereisit's catalog assistant. The user describes or photographs a
place and we build a folder tree beneath a root the user already chose. Respond
with STRICT JSON only (no prose, no fences):
{"nodes":[{"name": string, "children":[<same shape>], "items":[{"name": string,
  "alias": string|null, "category": string|null, "unit": string|null, "qty": int,
  "status": "present"|"consumed"|"lent"|null, "notes": string|null,
  "attrs":[["key","value"], ...]}]}]}

Critical distinction:
- children = ONLY containers/places that hold things (抽屉, 衣柜, 书架, 台面,
  床头柜...). NEVER put a physical object under children.
- items = the physical objects themselves (剪刀, 水杯, 台灯, 胶带, 手机...).
  Never create a child space for an object — an object always goes to items.

Extract EVERY descriptive attribute that is clearly stated into attrs as
["key","value"] — keys like 颜色 / 尺寸 / 材质 / 品牌 / 型号 / 成色(新旧) /
规格 / 产地. Examples: [["颜色","红色"]], [["材质","玻璃"]], [["尺寸","32寸"]],
[["品牌","索尼"]], [["型号","PS5"]], [["成色","全新"]]. The name stays short
("水杯", not "红色水杯"); quantity still goes in qty (e.g. 三把 → qty 3).
category = the functional kind (文具/餐具/电子/工具/杯具/收纳...), or null if unsure.

Other rules:
- Prefer the user's language (Chinese if input is Chinese); short names.
- qty defaults to 1; status defaults to "present".
- Only include what is visible/clearly stated; do NOT invent a top scene name
  (the root is chosen by the user). At most a few levels; omit empty items lists.

Example: 抽屉里有一把红色剪刀
→ {"nodes":[{"name":"抽屉","children":[],"items":[{"name":"剪刀","category":"工具",
   "qty":1,"attrs":[["颜色","红色"]]}]}]}"""


def _strip_json(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        raw = raw.rsplit("```", 1)[0].strip()
    return raw


def complete_json(
    base_url: str,
    api_key: str | None,
    model: str,
    text: str | None,
    image_bytes: bytes | None = None,
    system: str = _TREE_SYSTEM,
    max_tokens: int = 1800,
) -> tuple[dict | None, str | None]:
    """Call a multimodal model (Anthropic or OpenAI-compatible) and parse JSON."""
    if not base_url:
        return None, None
    is_anthropic = "anthropic.com" in base_url
    if is_anthropic:
        return _complete_anthropic(api_key, model, text, image_bytes, system, max_tokens)
    return _complete_openai(base_url, api_key, model, text, image_bytes, system, max_tokens)


def _complete_openai(base_url, api_key, model, text, image_bytes, system, max_tokens):
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
        return None, None
    try:
        for attempt in (1, 2):
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
                break
            except openai.RateLimitError:
                if attempt == 2:
                    return None, "模型限流了，请稍等几秒再试"
                time.sleep(3)
        raw = _strip_json(resp.choices[0].message.content or "")
        return json.loads(raw), None
    except Exception:
        return None, None


def _complete_anthropic(api_key, model, text, image_bytes, system, max_tokens):
    if not api_key:
        return None, "Claude 需要 API Key"
    client = anthropic.Anthropic(api_key=api_key)
    content: list[dict] = []
    if text and text.strip():
        content.append({"type": "text", "text": text.strip()})
    if image_bytes:
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": base64.b64encode(image_bytes).decode(),
                },
            }
        )
    if not content:
        return None, None
    try:
        for attempt in (1, 2):
            try:
                resp = client.messages.create(
                    model=model,
                    system=system,
                    messages=[{"role": "user", "content": content}],
                    max_tokens=max_tokens,
                    temperature=0.2,
                )
                break
            except anthropic.RateLimitError:
                if attempt == 2:
                    return None, "模型限流了，请稍等几秒再试"
                time.sleep(3)
        raw = _strip_json(resp.content[0].text)
        return json.loads(raw), None
    except Exception:
        return None, None