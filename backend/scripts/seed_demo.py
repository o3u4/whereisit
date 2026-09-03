"""Seed a demo library (spaces + items) against a running backend.

Usage:  python scripts/seed_demo.py
Destructive: wipes spaces (lots cascade) first, then builds the 4-scene tree
from the frontend mock and registers the 9 demo items. Idempotent: rerunning
recreates the same state (defs/aliases/attrs are reused, lots are fresh).
"""

from __future__ import annotations

import json
import urllib.request

HOST = "http://localhost:8080"
SCENES = [
    {
        "name": "卧室", "type": "room", "group": "家",
        "tintA": "oklch(52% .09 178)", "tintB": "oklch(82% .08 165)",
        "kids": [
            {"name": "衣柜", "type": "wardrobe", "kids": [
                {"name": "中层隔板", "type": "shelf", "kids": []},
            ]},
            {"name": "床头柜", "type": "drawer", "kids": [
                {"name": "上层抽屉", "type": "drawer", "kids": []},
            ]},
            {"name": "飘窗收纳", "type": "box", "kids": []},
        ],
    },
    {
        "name": "书房", "type": "room", "group": "家",
        "tintA": "oklch(50% .10 235)", "tintB": "oklch(80% .07 205)",
        "kids": [
            {"name": "书桌", "type": "desk", "kids": [
                {"name": "左侧抽屉", "type": "drawer", "kids": []},
                {"name": "桌面", "type": "desk", "kids": []},
            ]},
            {"name": "文件柜", "type": "wardrobe", "kids": []},
        ],
    },
    {
        "name": "办公室 · 工位", "type": "desk", "group": "公司",
        "tintA": "oklch(55% .12 60)", "tintB": "oklch(84% .09 70)",
        "kids": [
            {"name": "桌面", "type": "desk", "kids": []},
            {"name": "抽屉 A2", "type": "drawer", "kids": []},
            {"name": "文件架", "type": "shelf", "kids": []},
        ],
    },
    {
        "name": "储物间", "type": "room", "group": "家",
        "tintA": "oklch(52% .06 230)", "tintB": "oklch(78% .06 170)",
        "kids": [
            {"name": "工具柜", "type": "wardrobe", "kids": [
                {"name": "工具箱", "type": "box", "kids": []},
            ]},
            {"name": "货架", "type": "shelf", "kids": [
                {"name": "上层", "type": "shelf", "kids": []},
            ]},
            {"name": "收纳箱 A", "type": "box", "kids": []},
        ],
    },
]

# path = chain of space names from root to the leaf the item sits in
ITEMS = [
    {"path": ("书房", "书桌", "左侧抽屉"), "name": "HDMI 线", "alias": "hdmi,高清线,视频线",
     "category": "电子配件", "unit": "条", "qty": 3, "status": "present",
     "attrs": [["长度", "2 m"], ["标记", "客厅备用"]]},
    {"path": ("办公室 · 工位", "抽屉 A2"), "name": "USB-C 快充线", "alias": "usb-c,type-c,充电线",
     "category": "电子配件", "unit": "条", "qty": 2, "status": "present",
     "attrs": [["长度", "1 m"], ["接口", "C → C"]]},
    {"path": ("卧室", "床头柜", "上层抽屉"), "name": "蓝牙耳机", "alias": "耳机,buds,earbuds",
     "category": "电子配件", "unit": "副", "qty": 1, "status": "lent",
     "attrs": [["颜色", "白色"]]},
    {"path": ("办公室 · 工位", "桌面"), "name": "充电宝", "alias": "移动电源,power bank",
     "category": "电子配件", "unit": "个", "qty": 1, "status": "present",
     "attrs": [["容量", "10 000 mAh"]]},
    {"path": ("卧室", "衣柜", "中层隔板"), "name": "护照", "alias": "passport,证件",
     "category": "证照文档", "unit": "本", "qty": 1, "status": "present",
     "attrs": [["姓名", "J · T"], ["有效期", "2031-04"]]},
    {"path": ("书房", "书桌", "桌面"), "name": "剪刀", "alias": "剪子,拆快递",
     "category": "工具", "unit": "把", "qty": 1, "status": "present",
     "attrs": [["用途", "拆快递"]]},
    {"path": ("储物间", "工具柜", "工具箱"), "name": "螺丝刀套装", "alias": "螺丝刀,screwdriver,工具",
     "category": "工具", "unit": "套", "qty": 1, "status": "present",
     "attrs": [["件数", "24 件"]]},
    {"path": ("储物间", "收纳箱 A"), "name": "备用钥匙", "alias": "钥匙,key",
     "category": "日用", "unit": "串", "qty": 1, "status": "present",
     "attrs": [["备注", "楼下信箱"]]},
    {"path": ("储物间", "货架", "上层"), "name": "创可贴", "alias": "ok 绷,邦迪",
     "category": "日用", "unit": "盒", "qty": 1, "status": "present",
     "attrs": [["规格", "100 片"]]},
]


def call(method: str, api: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        HOST + api + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())["data"]


def wipe() -> None:
    for node in call("GET", "/api/spaces", "/tree"):
        call("DELETE", "/api/spaces", f"/{node['id']}?mode=cascade")


def mk(name: str, type_tag: str, parent: int | None) -> dict:
    return call("POST", "/api/spaces", "", {"name": name, "type_tag": type_tag, "parent_id": parent})


def build_forest() -> dict[tuple[str, ...], int]:
    """Create the 4-scene tree; returns {name-path: space_id} for every node."""
    ids: dict[tuple[str, ...], int] = {}

    def create(spec: dict, parent: int | None, path: tuple[str, ...]) -> None:
        node = mk(spec["name"], spec["type"], parent)
        ids[path + (spec["name"],)] = node["id"]
        for kid in spec["kids"]:
            create(kid, node["id"], path + (spec["name"],))

    for scene in SCENES:
        root = mk(scene["name"], scene["type"], None)
        ids[(scene["name"],)] = root["id"]
        layout = {"group": scene["group"], "tintA": scene["tintA"], "tintB": scene["tintB"]}
        call("PATCH", "/api/spaces", f"/{root['id']}", {"layout_json": json.dumps(layout)})
        for kid in scene["kids"]:
            create(kid, root["id"], (scene["name"],))
    return ids


def seed_items(ids: dict[tuple[str, ...], int]) -> None:
    for item in ITEMS:
        call(
            "POST",
            "/api/items",
            "/register",
            {
                "name": item["name"],
                "alias": item["alias"],
                "category": item["category"],
                "unit": item["unit"],
                "qty": item["qty"],
                "status": item["status"],
                "space_id": ids[item["path"]],
                "attrs": [{"key": k, "value": v} for k, v in item["attrs"]],
            },
        )


def main() -> None:
    wipe()
    ids = build_forest()
    seed_items(ids)
    items = call("GET", "/api/items", "")
    tree = call("GET", "/api/spaces", "/tree")
    print(f"seeded {len(tree)} scene(s), {len(items)} item presence(s)")

    def dump(nodes, indent=0):
        for n in nodes:
            meta = json.loads(n["layout_json"]) if n["layout_json"] else None
            group = f" [{meta['group']}]" if meta and meta.get("group") else ""
            print("  " * indent + f"- {n['name']}{group} [{n['type_tag']}]")
            dump(n["children"], indent + 1)

    dump(tree)


if __name__ == "__main__":
    main()
