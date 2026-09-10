from __future__ import annotations

import base64
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.api import ok
from app.core.auth import get_current_user
from app.core.errors import BadRequest, ServiceUnavailable
from app.domains.llm import service

router = APIRouter(prefix="/api/llm", tags=["llm"])


class RecognizeBody(BaseModel):
    text: Optional[str] = None
    image_base64: Optional[str] = None  # base64 without the data: prefix


@router.post("/recognize", response_model=dict)
def recognize(payload: RecognizeBody, user_id: int = Depends(get_current_user)) -> dict:
    if not service.available():
        raise ServiceUnavailable("LLM 未配置（LLM_BASE_URL）")
    image = None
    if payload.image_base64:
        try:
            image = base64.b64decode(payload.image_base64)
        except Exception:
            raise BadRequest("无效的图片 base64")
    result = service.complete_json(payload.text, image)
    if result is None:
        raise BadRequest("模型未能返回有效结果（检查 LLM_BASE_URL / LLM_MODEL 配置）")
    return ok(result)