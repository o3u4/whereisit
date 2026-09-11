from __future__ import annotations

import base64
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.api import ok
from app.core.auth import get_current_user
from app.core.errors import BadRequest, ServiceUnavailable
from app.db.engine import read
from app.domains.llm import service
from app.domains.settings import service as settings_service

router = APIRouter(prefix="/api/llm", tags=["llm"])


class RecognizeBody(BaseModel):
    text: Optional[str] = None
    image_base64: Optional[str] = None  # base64 without the data: prefix


@router.post("/recognize", response_model=dict)
def recognize(payload: RecognizeBody, user_id: int = Depends(get_current_user)) -> dict:
    with read() as conn:
        llm = settings_service.llm_config(conn)
    if not llm["base_url"]:
        raise ServiceUnavailable("LLM 未配置，请在设置里填接口地址")
    image = None
    if payload.image_base64:
        try:
            image = base64.b64decode(payload.image_base64)
        except Exception:
            raise BadRequest("无效的图片 base64")
    result, err = service.complete_json(
        base_url=llm["base_url"], api_key=llm["api_key"], model=llm["model"],
        text=payload.text, image_bytes=image,
    )
    if result is None:
        raise BadRequest(err or "模型未能返回有效结果（检查设置里的接口 / 模型）")
    return ok(result)