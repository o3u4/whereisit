"""Seed a small demo space tree against a running backend (http://localhost:8080).

Usage:  python scripts/seed_demo.py
Destructive: wipes spaces first, then inserts the demo tree below.
"""

from __future__ import annotations

import json
import urllib.request

BASE = "http://localhost:8080/api/spaces"


def call(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())["data"]


def wipe() -> None:
    for node in call("GET", "/tree"):
        call("DELETE", f"/{node['id']}?mode=cascade")


def mk(name: str, type_tag: str, parent: int | None) -> dict:
    return call("POST", "", {"name": name, "type_tag": type_tag, "parent_id": parent})


def main() -> None:
    wipe()
    bedroom = mk("卧室", "room", None)
    office = mk("办公室", "room", None)

    wardrobe = mk("衣柜", "wardrobe", bedroom["id"])
    mk("上排左格", "drawer", wardrobe["id"])
    mk("上排右格", "drawer", wardrobe["id"])
    mk("下层挂杆", "shelf", wardrobe["id"])

    desk = mk("书桌", "desk", bedroom["id"])
    mk("左抽屉", "drawer", desk["id"])
    mk("右抽屉", "drawer", desk["id"])
    mk("桌面", "shelf", desk["id"])

    cabinet = mk("文件柜", "wardrobe", office["id"])
    mk("A 格", "drawer", cabinet["id"])
    mk("B 格", "drawer", cabinet["id"])

    tree = call("GET", "/tree")
    print(f"seeded {len(tree)} root domain(s)")

    def dump(nodes, indent=0):
        for n in nodes:
            print("  " * indent + f"- {n['name']} [{n['type_tag']}]")
            dump(n["children"], indent + 1)

    dump(tree)


if __name__ == "__main__":
    main()
