from __future__ import annotations

import base64
import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.api import ok
from app.core.auth import get_current_user
from app.core.errors import BadRequest, NotFound, ServiceUnavailable
from app.db.engine import read, tx
from app.domains.llm import agent
from app.domains.llm import service
from app.domains.settings import service as settings_service

router = APIRouter(prefix="/api/llm", tags=["llm"])


class RecognizeBody(BaseModel):
    text: str | None = None
    image_base64: str | None = None  # base64 without the data: prefix


class PlanBody(BaseModel):
    message: str | None = None
    attachments: list[dict] | None = None
    revision: str | None = None
    prev_steps: list[dict] | None = None


class ApplyBody(BaseModel):
    plan: list[dict]
    attachments: list[dict] | None = None


class UndoBody(BaseModel):
    undo_id: int


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


@router.post("/agent/plan", response_model=dict)
def agent_plan(payload: PlanBody, user_id: int = Depends(get_current_user)) -> dict:
    with read() as conn:
        llm = settings_service.llm_config(conn)
    if not llm["base_url"]:
        raise ServiceUnavailable("LLM 未配置，请在设置里填接口地址")
    steps, reply, reads = agent.plan_agent(
        llm["base_url"], llm["api_key"], llm["model"], user_id, payload.message, payload.attachments,
        revision=payload.revision, prev_steps=payload.prev_steps,
    )
    return ok({"steps": agent.validate_plan(steps), "reply": reply, "reads": reads})


@router.post("/agent/apply", response_model=dict)
def agent_apply(payload: ApplyBody, user_id: int = Depends(get_current_user)) -> dict:
    plan = agent.validate_plan(payload.plan)
    results, undo_id = agent.apply_plan(user_id, plan, payload.attachments)
    return ok({"results": results, "undo_id": undo_id})


@router.post("/agent/undo", response_model=dict)
def agent_undo(payload: UndoBody, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        row = conn.execute(
            "SELECT data_json FROM agent_undo WHERE id = ? AND user_id = ?", (payload.undo_id, user_id)
        ).fetchone()
        if row is None:
            raise NotFound("无该撤销记录")
        data = json.loads(row["data_json"])
        restored = agent.restore_undo(conn, user_id, data)
        conn.execute("DELETE FROM agent_undo WHERE id = ?", (payload.undo_id,))
    return ok({"restored": restored})
