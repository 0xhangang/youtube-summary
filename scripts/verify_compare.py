#!/usr/bin/env python3
"""compare-alsangmu.html 무손실 검증.

C안(무손실 본문 + 구조 시각화)이 A안(순수 텍스트) 본문을 문장 단위로 100% 보존하는지
assert 한다. 시각화 블록(stats/levels/flow/compare/table/svg...)은 본문 대조에서 제외하고
본문 블록(h/p/ul/ol/callout)만 순서대로 비교한다.

    python3 scripts/verify_compare.py            # 검증 + 리포트
    python3 scripts/verify_compare.py --quiet    # 통과/실패만
"""
import json, re, sys, pathlib

HTML = pathlib.Path(__file__).resolve().parent.parent / 'compare-alsangmu.html'
BODY_TYPES = {'h', 'p', 'ul', 'ol', 'callout'}
VIZ_TYPES = {'stats', 'levels', 'flow', 'compare', 'table', 'svg', 'bars', 'donut', 'timeline'}
SENT_RE = re.compile(r'.+?(?:[.?!](?=\s|$)|$)', re.S)


def load():
    text = HTML.read_text(encoding='utf-8')
    m = re.search(r'var DATA = (\{.*?\});\n  var META', text, re.S)
    assert m, 'DATA 블록을 찾지 못함'
    return json.loads(m.group(1))


def body_blocks(blocks):
    return [b for b in blocks if b.get('type') in BODY_TYPES]


def body_text(blocks):
    out = []
    for b in blocks:
        if b.get('type') in ('p', 'callout', 'h'):
            out.append(b.get('text') or '')
        elif b.get('type') in ('ul', 'ol'):
            out.extend(b.get('items') or [])
    return out


def sentences(lines):
    out = []
    for ln in lines:
        for s in SENT_RE.findall(ln.replace('\n', ' ')):
            s = s.strip()
            if s:
                out.append(s)
    return out


def main():
    quiet = '--quiet' in sys.argv
    data = load()
    v = data['versions']
    A, C = v['a']['blocks'], v['c']['blocks']

    a_body, c_body = body_blocks(A), body_blocks(C)
    ok = True
    fails = []

    # 1) 본문 블록 타입·순서 동일
    if [b['type'] for b in a_body] != [b['type'] for b in c_body]:
        ok = False
        fails.append('본문 블록 구성이 다름: %s vs %s'
                     % ([b['type'] for b in a_body], [b['type'] for b in c_body]))

    # 2) 본문 텍스트 완전 일치 (문단 단위)
    a_lines, c_lines = body_text(a_body), body_text(c_body)
    if a_lines != c_lines:
        ok = False
        for i, (x, y) in enumerate(zip(a_lines, c_lines)):
            if x != y:
                fails.append('문단 %d 불일치\n  A: %s\n  C: %s' % (i, x[:120], y[:120]))
                break
        if len(a_lines) != len(c_lines):
            fails.append('문단 수 다름: A %d vs C %d' % (len(a_lines), len(c_lines)))

    # 3) 문장 단위 대조
    a_s, c_s = sentences(a_lines), sentences(c_lines)
    if a_s != c_s:
        ok = False
        fails.append('문장 단위 불일치: A %d문장 vs C %d문장' % (len(a_s), len(c_s)))

    # 4) 소제목 개수 동일
    a_h = [b['text'] for b in a_body if b['type'] == 'h']
    c_h = [b['text'] for b in c_body if b['type'] == 'h']
    if a_h != c_h:
        ok = False
        fails.append('소제목 불일치')

    if ok:
        viz = [b['type'] for b in C if b.get('type') in VIZ_TYPES]
        marks = lambda bs: len(re.findall(r'\*\*[^*]+\*\*', ' '.join(body_text(bs))))
        if not quiet:
            print('✅ C안 본문 100%% 무손실 — A안과 문단 %d개·문장 %d개·소제목 %d개 완전 일치'
                  % (len(a_lines), len(a_s), len(a_h)))
            print('   글자수 A %d / C %d · 형광펜 A %d / C %d'
                  % (len(' '.join(a_lines)), len(' '.join(c_lines)), marks(a_body), marks(c_body)))
            print('   C안 시각화 %d개: %s' % (len(viz), ', '.join(viz)))
        return 0

    print('❌ 무손실 검증 실패')
    for f in fails:
        print(' -', f)
    return 1


if __name__ == '__main__':
    sys.exit(main())
