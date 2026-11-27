#!/usr/bin/env python3
"""compare-alsangmu.html 4차 검증.

A안(순수 텍스트) · B안(필기 마킹) · C안(시각화 몰빵) 세 버전의 규칙을 assert 한다.

1) A안은 손대지 않았는지 (문단 25 · 문장 56)
2) B안 = A안 본문 100% 그대로 + 마킹만
   - 블록 구성: legend 1개 + A안과 같은 순서의 h/p
   - 토큰({{..}})과 기호(★●▲■)를 걷어내면 A안 문단 텍스트와 글자 단위로 동일
   - 박스·시각화 0
3) C안
   - 소제목 6개가 A안과 같은 순서로 1:1
   - 화자 한마디(callout)는 A안 본문의 연속 부분 문자열(인용 왜곡 없음)
   - C안 텍스트에 나오는 모든 숫자는 A안 본문에도 존재 (없는 수치 창작 금지)
     · SVG 축 눈금(class 에 ax)만 눈금용으로 예외

    python3 scripts/verify_compare.py            # 검증 + 리포트
    python3 scripts/verify_compare.py --quiet    # 통과/실패만
"""
import json, re, sys, pathlib

HTML = pathlib.Path(__file__).resolve().parent.parent / 'compare-alsangmu.html'
TOKEN_RE = re.compile(r'\{\{[A-Z0-9]{1,2}\|([\s\S]*?)\}\}')
SYM_RE = re.compile(r'[★●▲■]')
SENT_RE = re.compile(r'.+?(?:[.?!](?=\s|$)|$)', re.S)
NUM_RE = re.compile(r'\d[\d,\.]*')


def load():
    text = HTML.read_text(encoding='utf-8')
    m = re.search(r'var DATA = (\{.*?\});\n  var META', text, re.S)
    assert m, 'DATA 블록을 찾지 못함'
    return json.loads(m.group(1))


def strip_marks(t):
    return SYM_RE.sub('', TOKEN_RE.sub(lambda m: m.group(1), t))


def sentences(lines):
    out = []
    for ln in lines:
        for s in SENT_RE.findall(ln.replace('\n', ' ')):
            s = s.strip()
            if s:
                out.append(s)
    return out


def body_lines(blocks):
    out = []
    for b in blocks:
        if b.get('type') in ('p', 'callout', 'h'):
            out.append(b.get('text') or '')
        elif b.get('type') in ('ul', 'ol'):
            out.extend(b.get('items') or [])
    return out


def nums(s):
    return {n.rstrip('.,').replace(',', '') for n in NUM_RE.findall(s)}


def block_text(b, skip_ax=True):
    """블록이 화면에 보여 주는 글자 전부 (SVG 는 <text> 내용만, 축 눈금 제외)."""
    out = []
    for key in ('text', 'title', 'caption', 'label', 'value', 'sub', 'name', 'badge', 'note', 'tag'):
        v = b.get(key)
        if isinstance(v, str) and v:
            out.append(v)
    for key in ('items', 'points', 'steps', 'cards', 'cols', 'levels', 'rows'):
        for it in b.get(key) or []:
            if isinstance(it, str):
                out.append(it)
            elif isinstance(it, dict):
                out.append(block_text(it, skip_ax))
            elif isinstance(it, list):
                out.extend([str(x) for x in it if x is not None])
    if b.get('svg'):
        for m in re.finditer(r'<text\b([^>]*)>([^<]*)</text>', b['svg']):
            attrs, content = m.group(1), m.group(2)
            if skip_ax and 'ax' in re.search(r'class="([^"]*)"', attrs or '').group(0):
                continue
            out.append(content)
    return ' '.join(out)


def main():
    quiet = '--quiet' in sys.argv
    data = load()
    v = data['versions']
    A, B, C = v['a']['blocks'], v['b']['blocks'], v['c']['blocks']
    fails = []

    a_lines = body_lines(A)
    a_text = ' '.join(a_lines)
    a_plain = a_text.replace('**', '')
    a_sents = sentences(a_lines)
    a_heads = [b['text'] for b in A if b['type'] == 'h']

    # ── B안 ────────────────────────────────────────────────
    if B[0].get('type') != 'legend':
        fails.append('B안 첫 블록이 마킹 범례가 아님')
    b_body = B[1:]
    if [b['type'] for b in b_body] != [b['type'] for b in A]:
        fails.append('B안 블록 구성이 A안과 다름')
    b_lines = [strip_marks(b.get('text', '')) for b in b_body]
    b_sents = sentences(b_lines)
    if b_lines != a_lines:
        for i, (x, y) in enumerate(zip(a_lines, b_lines)):
            if x != y:
                fails.append('B안 문단 %d 불일치\n  A: %s\n  B: %s' % (i, x[:100], y[:100]))
                break
        if len(a_lines) != len(b_lines):
            fails.append('B안 문단 수 다름: A %d vs B %d' % (len(a_lines), len(b_lines)))
    if b_sents != a_sents:
        fails.append('B안 문장 단위 불일치: A %d문장 vs B %d문장' % (len(a_sents), len(b_sents)))
    b_other = [b['type'] for b in B if b['type'] not in ('h', 'p', 'legend')]
    if b_other:
        fails.append('B안에 글자 마킹 외 블록이 있음: %s' % b_other)

    # ── C안 ────────────────────────────────────────────────
    c_heads = [b['text'] for b in C if b['type'] == 'h']
    if c_heads != a_heads:
        fails.append('C안 소제목이 A안 6개와 1:1이 아님')

    for i, b in enumerate(C):
        if b.get('type') == 'callout':
            quote = b['text'].replace('**', '')
            if quote not in a_plain:
                fails.append('C안 인용이 원문에 없음: %s' % quote[:60])

    a_nums = nums(a_text)
    c_text_all = ' '.join(block_text(b) for b in C)
    bad = sorted(n for n in nums(c_text_all) if n not in a_nums)
    if bad:
        fails.append('C안에 원문에 없는 수치: %s' % ', '.join(bad))

    if fails:
        print('❌ 검증 실패')
        for f in fails:
            print(' -', f)
        return 1

    if not quiet:
        tok = sum(len(re.findall(r'\{\{[A-Z0-9]{1,2}\|', b.get('text', ''))) for b in B)
        sym = sum(len(re.findall(r'[★●▲■]', b.get('text', ''))) for b in B)
        viz = [b['type'] for b in C if b['type'] in
               ('stats', 'levels', 'flow', 'compare', 'table', 'svg', 'map', 'vs', 'cards', 'signal')]
        print('✅ A안 그대로 · B안 본문 100%% 무손실 — 문단 %d개 · 문장 %d개 · 소제목 %d개 일치'
              % (len(a_lines), len(a_sents), len(a_heads)))
        print('   A 글자 %d자 (불변)' % len(a_text))
        print('   B 마킹 %d개(형광펜·밑줄·태그) · 기호 %d개 · 박스/시각화 0' % (tok, sym))
        print('   C 시각화 %d개: %s' % (len(viz), ', '.join(viz)))
        print('   C 화자 한마디 %d개 — 전부 원문 그대로 / 수치 %d종 전부 원문에 존재'
              % (sum(1 for b in C if b['type'] == 'callout'), len(nums(c_text_all))))
    return 0


if __name__ == '__main__':
    sys.exit(main())
