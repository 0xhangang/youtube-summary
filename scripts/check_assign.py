#!/usr/bin/env python3
"""레이더 채널 배정표 검증 — RULES.md 5장·아침 점검용.

data/channels.json 의 watched: true 채널과 data/radar_assign.json 의
satoshi[] / vitalik[] 가 1:1 로 맞는지 확인한다.

    python3 scripts/check_assign.py         # 정상이면 요약 한 줄, 어긋나면 exit 1
    python3 scripts/check_assign.py -v      # 채널 수·교집합까지 자세히
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANNELS = os.path.join(ROOT, "data", "channels.json")
ASSIGN = os.path.join(ROOT, "data", "radar_assign.json")

# channels.json 에 URL 이 없는 채널의 실제 채널 ID (notes.md 기준)
FALLBACK_IDS = {"이힛차트": "UC-unM7touB_ltVj3Vo-8p9A"}


def channel_id(entry):
    m = re.search(r"/channel/(UC[\w-]+)", entry.get("url", ""))
    return m.group(1) if m else None


def main():
    verbose = "-v" in sys.argv[1:]
    channels = json.load(open(CHANNELS, encoding="utf-8"))
    assign = json.load(open(ASSIGN, encoding="utf-8"))

    watched = {}
    for name, entry in channels.items():
        if entry.get("watched") is True:
            watched[name] = channel_id(entry) or FALLBACK_IDS.get(name)
    missing = [n for n, i in watched.items() if not i]

    vit = {c["channelId"]: c["name"] for c in assign.get("vitalik", [])}
    sat = {c["channelId"]: c["name"] for c in assign.get("satoshi", [])}
    w_ids = {i: n for n, i in watched.items() if i}

    problems = []
    if missing:
        problems.append(f"channels.json watched 채널 ID 없음: {', '.join(missing)}")
    if len(vit) != len(assign.get("vitalik", [])):
        problems.append("radar_assign.json vitalik 에 중복 channelId")
    if len(sat) != len(assign.get("satoshi", [])):
        problems.append("radar_assign.json satoshi 에 중복 channelId")
    dup = set(vit) & set(sat)
    if dup:
        problems.append(f"양쪽에 중복 배정: {', '.join(sorted(dup))}")
    union = set(vit) | set(sat)
    not_assigned = sorted(set(w_ids) - union)
    not_watched = sorted(union - set(w_ids))
    if not_assigned:
        problems.append("배정표에 없는 감시 채널: " + ", ".join(w_ids[i] for i in not_assigned))
    if not_watched:
        problems.append("감시 목록에 없는 배정 채널: " + ", ".join(vit.get(i) or sat.get(i) or i for i in not_watched))
    for i, n in list(vit.items()) + list(sat.items()):
        if i in w_ids and w_ids[i] != n:
            problems.append(f"이름 불일치({i}): 배정표 '{n}' / channels.json '{w_ids[i]}'")

    if verbose:
        print(f"watched {len(w_ids)} · vitalik {len(vit)} · satoshi {len(sat)} · 교집합 {len(dup)} · 합집합 {len(union)}")
        print("schedule:", assign.get("schedule"))

    if problems:
        for p in problems:
            print("✗", p, file=sys.stderr)
        return 1

    print(f"OK · 감시 {len(w_ids)} = 사토시 {len(sat)} + 비탈릭 {len(vit)} (교집합 0)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
