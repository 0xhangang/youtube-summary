#!/usr/bin/env python3
"""레이더 배정표·자동 백업(Failover) 상태 검증 — RULES.md 5장·6장·아침 점검용.

1) data/channels.json 의 watched: true 채널과 data/radar_assign.json 의
   satoshi[] / vitalik[] 가 1:1 로 맞는지 확인한다.
2) data/failover.json 이 스키마대로인지, 지금 시각 기준으로 유효한지 확인한다.
   - mode: "failover" 라도 expiresAt(다음 04:00 KST)이 지났으면 자동 복구 상태(normal)로 본다.
   - 살아 있는 쪽·소진 표시·backup_owner 가 서로 안 맞으면 오류로 잡는다.

    python3 scripts/check_assign.py         # 정상이면 요약 두 줄, 어긋나면 exit 1
    python3 scripts/check_assign.py -v      # 채널 수·교집합·failover 필드까지 자세히

종료 코드: 오류(✗)가 있으면 1, 경고(!)만 있으면 0.
"""

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANNELS = os.path.join(ROOT, "data", "channels.json")
ASSIGN = os.path.join(ROOT, "data", "radar_assign.json")
FAILOVER = os.path.join(ROOT, "data", "failover.json")

# channels.json 에 URL 이 없는 채널의 실제 채널 ID (notes.md 기준)
FALLBACK_IDS = {"이힛차트": "UC-unM7touB_ltVj3Vo-8p9A"}

KST = timezone(timedelta(hours=9))
RESET_HOUR = 4  # 일일 사용량 한도 리셋 시각 (RULES.md §6-5)
WORKERS = ("satoshi", "vitalik")
WORKER_LABEL = {"satoshi": "사토시", "vitalik": "비탈릭"}

FAILOVER_ENUMS = {
    "mode": ("normal", "failover"),
    "satoshi_status": ("active", "exhausted"),
    "vitalik_status": ("active", "exhausted"),
    "backup_owner": (None, "satoshi", "vitalik"),
}


def channel_id(entry):
    m = re.search(r"/channel/(UC[\w-]+)", entry.get("url", ""))
    return m.group(1) if m else None


# ---------------------------------------------------------------- failover

def parse_kst(value, field, problems, required=False):
    """KST ISO 시각을 datetime 으로. null 이면 None."""
    if value is None:
        if required:
            problems.append(f"failover.json {field} 없음")
        return None
    if not isinstance(value, str):
        problems.append(f"failover.json {field} 는 문자열 시각이어야 함: {value!r}")
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        problems.append(f"failover.json {field} 시각 형식 오류: {value!r}")
        return None
    if dt.tzinfo is None:
        problems.append(f"failover.json {field} 에 시간대 없음: {value!r} (KST로 간주)")
        dt = dt.replace(tzinfo=KST)
    return dt.astimezone(KST)


def human_remaining(delta):
    total = int(delta.total_seconds())
    if total <= 0:
        return "0분"
    hours, minutes = divmod(total // 60, 60)
    if hours and minutes:
        return f"{hours}시간 {minutes}분"
    if hours:
        return f"{hours}시간"
    return f"{minutes}분"


def check_failover(fo, now):
    """failover.json 내용 검증. (problems, warnings, summary, detail) 반환."""
    problems, warnings = [], []

    if fo is None:
        return ["data/failover.json 없음 — RULES.md §6 상태 원장이 빠졌다"], [], "failover: 파일 없음", {}
    if not isinstance(fo, dict):
        return ["failover.json 최상위가 객체가 아님"], [], "failover: 형식 오류", {}

    for field, allowed in FAILOVER_ENUMS.items():
        if field not in fo:
            problems.append(f"failover.json '{field}' 필드 없음")
        elif fo[field] not in allowed:
            ok = ", ".join("null" if v is None else f'"{v}"' for v in allowed)
            problems.append(f"failover.json '{field}' 값이 범위 밖: {fo[field]!r} (허용 {ok})")
    for field in ("reason", "activatedAt", "expiresAt", "updatedAt"):
        if field not in fo:
            problems.append(f"failover.json '{field}' 필드 없음")

    mode = fo.get("mode")
    sat = fo.get("satoshi_status")
    vit = fo.get("vitalik_status")
    owner = fo.get("backup_owner")
    reason = fo.get("reason")

    if reason is not None and not isinstance(reason, str):
        problems.append(f"failover.json 'reason' 은 문자열 또는 null 이어야 함: {reason!r}")
    activated = parse_kst(fo.get("activatedAt"), "activatedAt", problems)
    expires = parse_kst(fo.get("expiresAt"), "expiresAt", problems)
    updated = parse_kst(fo.get("updatedAt"), "updatedAt", problems, required=True)

    status = {"satoshi": sat, "vitalik": vit}
    exhausted = [w for w in WORKERS if status[w] == "exhausted"]

    expired = bool(mode == "failover" and expires and now >= expires)
    if mode == "failover" and expires is None:
        problems.append("failover.json mode가 \"failover\"인데 expiresAt이 없다 — 자동 복구가 안 된다(§6-5)")
        effective = "failover"
    else:
        effective = "normal" if (mode == "normal" or expired) else mode

    if mode == "failover" and owner is None and not exhausted:
        problems.append("failover.json mode \"failover\"인데 backup_owner도 소진 표시도 없다")
    if effective == "failover" and owner is not None and not exhausted:
        problems.append(f"failover.json 백업 발동 상태인데 소진된 워커가 없다 (backup_owner={owner!r})")
    if mode == "normal" and owner is not None:
        problems.append(f"failover.json mode가 \"normal\"인데 backup_owner={owner!r} — 모드가 서로 맞지 않는다")

    if len(exhausted) == 2:
        warnings.append("양쪽 모두 exhausted — 백업할 곳이 없다. 04:00 KST 리셋까지 신규 요약이 멈춘다(사용자 안내 필요)")
        if owner is not None:
            problems.append("양쪽 소진인데 backup_owner가 지정돼 있다 (백업 불가 상태에서는 null)")
    elif len(exhausted) == 1:
        down = exhausted[0]
        alive = WORKERS[1] if down == WORKERS[0] else WORKERS[0]
        if effective == "failover":
            if owner is None:
                problems.append(f"{WORKER_LABEL[down]}가 소진인데 backup_owner가 없다 — 살아 있는 쪽은 {WORKER_LABEL[alive]}")
            elif owner != alive:
                problems.append(
                    f"backup_owner가 {WORKER_LABEL.get(owner, owner)}인데 살아 있는 쪽은 {WORKER_LABEL[alive]} — "
                    f"{WORKER_LABEL[down]} 소진 상태와 맞지 않는다"
                )
            if not isinstance(reason, str) or not reason.strip():
                warnings.append("백업 발동 상태인데 reason이 비어 있다 — 감지 신호를 남긴다(§6-3)")
        else:  # normal 이거나 만료
            if mode == "normal":
                warnings.append(
                    f"mode \"normal\"인데 {WORKER_LABEL[down]}가 exhausted — 백업 없이 그쪽만 쉬는 상태로 읽는다"
                )
    if expired:
        warnings.append(
            f"expiresAt {expires.isoformat()} 경과 — 자동 복구(normal)로 간주한다. "
            "파일 정리는 집사 아침 스캔에서 `failover OFF(자동 복구)` 커밋으로(§6-5)"
        )
    elif mode == "normal" and (activated or expires):
        warnings.append("mode \"normal\"인데 activatedAt·expiresAt 기록이 남아 있다 — 정리 권장")

    # 요약 한 줄
    state = f"사토시 {sat} · 비탈릭 {vit}"
    if effective == "failover":
        left = f" · {expires.isoformat()}까지 (남은 {human_remaining(expires - now)})" if expires else ""
        who = f"{WORKER_LABEL[owner]} 백업" if owner else "백업 불가(양쪽 소진)"
        summary = f"failover: ON · {who} · {state}{left}"
    elif expired:
        summary = f"failover: normal(자동 복구 · expiresAt {expires.isoformat()} 경과) · {state} — normal로 정리 권장"
    else:
        summary = f"failover: normal · {state}"

    detail = {
        "now(KST)": now.isoformat(),
        "mode": mode,
        "effective": effective,
        "expired": expired,
        "status": status,
        "backup_owner": owner,
        "reason": reason,
        "activatedAt": activated.isoformat() if activated else None,
        "expiresAt": expires.isoformat() if expires else None,
        "updatedAt": updated.isoformat() if updated else None,
    }
    return problems, warnings, summary, detail


# ---------------------------------------------------------------- assign

def check_assign(channels, assign):
    """채널 배정표 검증. (problems, detail_lines) 반환."""
    problems = []

    watched = {}
    for name, entry in channels.items():
        if entry.get("watched") is True:
            watched[name] = channel_id(entry) or FALLBACK_IDS.get(name)
    missing = [n for n, i in watched.items() if not i]

    vit = {c["channelId"]: c["name"] for c in assign.get("vitalik", [])}
    sat = {c["channelId"]: c["name"] for c in assign.get("satoshi", [])}
    w_ids = {i: n for n, i in watched.items() if i}

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

    detail_lines = [
        f"watched {len(w_ids)} · vitalik {len(vit)} · satoshi {len(sat)} · 교집합 {len(dup)} · 합집합 {len(union)}",
        f"schedule: {assign.get('schedule')}",
    ]
    summary = f"OK · 감시 {len(w_ids)} = 사토시 {len(sat)} + 비탈릭 {len(vit)} (교집합 0)"
    return problems, detail_lines, summary


def main():
    verbose = "-v" in sys.argv[1:]

    channels = json.load(open(CHANNELS, encoding="utf-8"))
    assign = json.load(open(ASSIGN, encoding="utf-8"))

    problems, detail_lines, assign_summary = check_assign(channels, assign)

    fo = None
    fo_error = None
    try:
        fo = json.load(open(FAILOVER, encoding="utf-8"))
    except FileNotFoundError:
        fo = None
    except (json.JSONDecodeError, OSError) as exc:
        fo = None
        fo_error = f"failover.json 읽기/파싱 실패: {exc}"

    now = datetime.now(KST)
    fo_problems, warnings, fo_summary, fo_detail = check_failover(fo, now)
    if fo_error:
        fo_problems.insert(0, fo_error)
    problems += fo_problems

    if verbose:
        for line in detail_lines:
            print(line)
        print("failover:", json.dumps(fo_detail, ensure_ascii=False, indent=2))

    for w in warnings:
        print("!", w, file=sys.stderr)
    if problems:
        for p in problems:
            print("✗", p, file=sys.stderr)
        return 1

    print(assign_summary)
    print(fo_summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
