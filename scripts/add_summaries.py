#!/usr/bin/env python3
"""유튜브 요약 추가 도구 — 스케줄 액션이 새 요약을 사이트에 붙일 때 쓴다.

사용법
    python3 scripts/add_summaries.py new.json              # 파일에서 읽기
    python3 scripts/add_summaries.py - < new.json           # 표준입력
    python3 scripts/add_summaries.py --date 2026-11-18 new.json
    python3 scripts/add_summaries.py --dry-run new.json      # 쓰지 않고 미리보기

입력 형식 (둘 다 허용)
    1) [ {summary}, {summary}, ... ]
    2) {"date": "2026-11-18", "label": "2026년 11월 18일 수요일", "summaries": [ ... ]}

summary 필드
    videoId   (필수) 유튜브 영상 ID. 고유 키. 같은 ID는 기본적으로 건너뛴다.
    title     (필수) 영상 제목
    channel   (필수) 채널 이름
    category  증시·매크로=stock, 코인·트레이딩=coin, AI·사회·트렌드=trend, 테크=tech, 경제=economy, 기타=etc
    categoryLabel  비우면 category에서 자동 채움
    blocks    본문 블록 배열 — [{"type":"h|p|ul|callout","text":..,"items":[..]}]
    text      blocks 대신 줄글 하나로 줄 때. 아래 규칙으로 blocks로 변환된다.
                "## 제목" / "### 제목"   -> h
                "- 항목" / "* 항목"      -> ul
                "> 인용"                 -> callout
                빈 줄로 나뉜 덩어리      -> p
              (본문 안의 **굵게** 표기는 그대로 유지된다)
    publishedAt / duration / kind / url  선택

동작
    - data/YYYY-MM-DD.json 에 요약을 뒤에 붙이고(같은 videoId는 건너뜀),
    - data/index.json 을 data/*.json 전체를 훑어 다시 만든다.
    - 푸시는 하지 않는다. 커밋·푸시는 호출하는 쪽에서 한다.
"""

import argparse
import datetime as dt
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
INDEX = os.path.join(DATA, "index.json")

CATEGORY_LABELS = {
    "stock": "증시·매크로",
    "coin": "코인·트레이딩",
    "trend": "AI·사회·트렌드",
    "tech": "테크",
    "economy": "경제",
    "etc": "기타",
}
WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"]


def now_kst():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=9)))


def iso(d):
    return d.isoformat(timespec="seconds")


def date_label(date_str):
    d = dt.date.fromisoformat(date_str)
    return "%d년 %d월 %d일 %s요일" % (d.year, d.month, d.day, WEEKDAYS[d.weekday()])


def text_to_blocks(text):
    """줄글 하나를 blocks로 바꾼다."""
    blocks = []
    buf = []

    def flush_para():
        if buf:
            blocks.append({"type": "p", "text": " ".join(x.strip() for x in buf).strip()})
            buf.clear()

    ul_items = []

    def flush_ul():
        if ul_items:
            blocks.append({"type": "ul", "items": list(ul_items)})
            ul_items.clear()

    for raw in text.replace("\r\n", "\n").split("\n"):
        line = raw.rstrip()
        s = line.strip()
        if not s:
            flush_para()
            flush_ul()
            continue
        m = re.match(r"^#{2,4}\s+(.*)$", s)
        if m:
            flush_para()
            flush_ul()
            blocks.append({"type": "h", "text": m.group(1).strip()})
            continue
        m = re.match(r"^[-*•]\s+(.*)$", s)
        if m:
            flush_para()
            ul_items.append(m.group(1).strip())
            continue
        m = re.match(r"^>\s?(.*)$", s)
        if m:
            flush_para()
            flush_ul()
            blocks.append({"type": "callout", "text": m.group(1).strip()})
            continue
        flush_ul()
        buf.append(s)
    flush_para()
    flush_ul()
    return blocks


def normalize(item, date_str, stamp):
    vid = (item.get("videoId") or item.get("id") or "").strip()
    if not vid:
        raise ValueError("videoId가 없는 요약: %r" % item.get("title"))
    s = {
        "id": vid,
        "videoId": vid,
        "url": item.get("url") or "https://www.youtube.com/watch?v=" + vid,
        "channel": (item.get("channel") or "").strip(),
        "category": (item.get("category") or "etc").strip(),
        "categoryLabel": (item.get("categoryLabel") or "").strip()
        or CATEGORY_LABELS.get((item.get("category") or "etc").strip(), "기타"),
        "title": (item.get("title") or "").strip(),
        "addedAt": item.get("addedAt") or stamp,
    }
    for k in ("publishedAt", "duration", "kind", "channelId"):
        if item.get(k):
            s[k] = item[k]

    blocks = item.get("blocks")
    if not blocks and item.get("text"):
        blocks = text_to_blocks(item["text"])
    if not blocks:
        raise ValueError("본문이 없는 요약: %r" % item.get("title"))
    clean = []
    for b in blocks:
        t = (b or {}).get("type") or "p"
        if t == "ul":
            items = [str(x) for x in (b.get("items") or []) if str(x).strip()]
            if items:
                clean.append({"type": "ul", "items": items})
        elif t in ("h", "callout", "p"):
            txt = str(b.get("text") or "").strip()
            if txt:
                clean.append({"type": t, "text": txt})
        else:
            txt = str(b.get("text") or "").strip()
            if txt:
                clean.append({"type": "p", "text": txt})
    s["blocks"] = clean
    return s


def load_date_file(date_str):
    path = os.path.join(DATA, date_str + ".json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return path, json.load(f)
    return path, {"date": date_str, "label": date_label(date_str), "updatedAt": None, "summaries": []}


def rebuild_index():
    """data/*.json을 훑어 index.json을 다시 만든다."""
    dates = []
    for path in glob.glob(os.path.join(DATA, "*.json")):
        name = os.path.basename(path)
        m = re.match(r"^(\d{4}-\d{2}-\d{2})\.json$", name)
        if not m:
            continue
        try:
            with open(path, encoding="utf-8") as f:
                doc = json.load(f)
        except Exception as e:  # noqa: BLE001
            print("경고: %s 읽기 실패 (%s)" % (name, e), file=sys.stderr)
            continue
        sums = doc.get("summaries") or []
        dates.append({
            "date": m.group(1),
            "label": doc.get("label") or date_label(m.group(1)),
            "count": len(sums),
            "file": "data/" + name,
            "updatedAt": doc.get("updatedAt"),
        })
    dates.sort(key=lambda d: d["date"], reverse=True)
    stamps = [d["updatedAt"] for d in dates if d.get("updatedAt")]
    updated = max(stamps) if stamps else iso(now_kst())
    for d in dates:
        d.pop("updatedAt", None)
    index = {"site": "📺 유튜브 상세 요약", "updatedAt": updated, "dates": dates}
    return index


def main():
    ap = argparse.ArgumentParser(description="유튜브 요약을 사이트 데이터에 추가")
    ap.add_argument("input", help="요약 JSON 파일 경로 또는 - (표준입력)")
    ap.add_argument("--date", help="YYYY-MM-DD (입력에 없을 때)")
    ap.add_argument("--replace", action="store_true", help="같은 videoId를 덮어쓰기")
    ap.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않고 결과만 출력")
    args = ap.parse_args()

    if args.input == "-":
        payload = json.load(sys.stdin)
    else:
        with open(args.input, encoding="utf-8") as f:
            payload = json.load(f)

    if isinstance(payload, list):
        items = payload
        date_str = args.date
        label = None
    elif isinstance(payload, dict):
        items = payload.get("summaries") or []
        date_str = args.date or payload.get("date")
        label = payload.get("label")
    else:
        raise SystemExit("입력은 배열 또는 {\"summaries\": [...]} 객체여야 합니다")

    if not items:
        raise SystemExit("추가할 요약이 없습니다")
    if not date_str:
        date_str = iso(now_kst())[:10]
    dt.date.fromisoformat(date_str)

    stamp = iso(now_kst())
    path, doc = load_date_file(date_str)
    if label:
        doc["label"] = label
    doc.setdefault("label", date_label(date_str))
    sums = doc.setdefault("summaries", [])
    have = {s.get("videoId") or s.get("id") for s in sums}

    added, skipped, replaced = 0, 0, 0
    for item in items:
        s = normalize(item, date_str, stamp)
        vid = s["videoId"]
        if vid in have:
            if args.replace:
                for i, old in enumerate(sums):
                    if (old.get("videoId") or old.get("id")) == vid:
                        sums[i] = s
                        break
                replaced += 1
            else:
                skipped += 1
                print("건너뜀(이미 있음): %s %s" % (vid, s["title"]), file=sys.stderr)
            continue
        sums.append(s)
        have.add(vid)
        added += 1

    doc["updatedAt"] = stamp

    print("날짜 %s · 추가 %d · 갱신 %d · 건너뜀 %d → %s (%d편)"
          % (date_str, added, replaced, skipped, os.path.relpath(path, ROOT), len(sums)))

    if args.dry_run:
        print(json.dumps({"date": doc["date"], "label": doc["label"], "count": len(sums)},
                         ensure_ascii=False))
        return

    os.makedirs(DATA, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write("\n")

    # 날짜 파일을 쓴 뒤에 훑어야 새 날짜가 index에 들어간다
    index = rebuild_index()
    entry = None
    for d in index["dates"]:
        if d["date"] == date_str:
            entry = d
            break
    if entry:
        entry["count"] = len(sums)
        entry["label"] = doc["label"]
    index["updatedAt"] = stamp

    with open(INDEX, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("index.json 갱신: %d일 / %d편" % (len(index["dates"]),
                                          sum(d["count"] for d in index["dates"])))


if __name__ == "__main__":
    main()
