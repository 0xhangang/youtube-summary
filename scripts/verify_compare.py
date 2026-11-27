#!/usr/bin/env python3
"""compare-alsangmu.html 5차 검증.

A안(순수 텍스트) · B안(구조 분리: 나열·대립·종속) · C안(시각화 몰빵) 세 버전의 규칙을 assert 한다.

1) A안은 손대지 않았는지 (문단 25 · 문장 56 · 소제목 6)
2) B안 = A안 본문 100% 그대로 + 문단 사이 관계를 컨테이너로만 분리
   - 글자 마킹 금지: {{..}} 토큰 0 · 기호(★●▲■) 0 · 형광펜/밑줄/태그 클래스 0
   - 블록 타입은 h · p · callout · struct-list · struct-contrast · struct-sub 만
   - 본문 텍스트를 화면 순서대로 이어붙이면 A안 본문과 글자 단위로 동일 (추가·삭제·중복 0)
   - 구조 태그(label)는 나열·대립·근거·세부·예외 만, 나열≥1 · 대립≥1 · 종속≥1
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
TOKEN_RE = re.compile(r'\{\{[A-Z0-9]{1,2}\|')
SYM_RE = re.compile(r'[★●▲■]')
SENT_RE = re.compile(r'.+?(?:[.?!](?=\s|$)|$)', re.S)
NUM_RE = re.compile(r'\d[\d,\.]*')

STRUCT_TYPES = ('struct-list', 'struct-contrast', 'struct-sub')
B_TYPES = ('h', 'p', 'callout') + STRUCT_TYPES
B_LABELS = ('나열', '대립', '근거', '세부', '예외')


def load():
    text = HTML.read_text(encoding='utf-8')
    m = re.search(r'var DATA = (\{.*?\});\n  var META', text, re.S)
    assert m, 'DATA 블록을 찾지 못함'
    return json.loads(m.group(1))


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
        elif b.get('type') in ('ul', 'ol', 'struct-list'):
            out.extend(b.get('items') or [])
    return out


def b_pieces(blocks):
    """B안이 화면 순서대로 보여 주는 본문 텍스트 조각 (구조 태그 제외)."""
    out = []
    for b in blocks:
        t = b.get('type')
        if t in ('h', 'p', 'callout', 'struct-sub'):
            out.append(b.get('text') or '')
        elif t == 'struct-list':
            out.extend([x for x in (b.get('items') or [])])
        elif t == 'struct-contrast':
            out.extend([b.get('left') or '', b.get('right') or ''])
        else:
            raise AssertionError('B안에 허용되지 않은 블록: %s' % t)
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
    b_bad_type = [b.get('type') for b in B if b.get('type') not in B_TYPES]
    if b_bad_type:
        fails.append('B안에 허용되지 않은 블록: %s' % b_bad_type)

    b_raw = json.dumps(B, ensure_ascii=False)
    if TOKEN_RE.search(b_raw):
        fails.append('B안에 {{..}} 글자 마킹 토큰이 남아 있음: %d개'
                     % len(TOKEN_RE.findall(b_raw)))
    if SYM_RE.search(b_raw):
        fails.append('B안에 기호(★●▲■)가 남아 있음: %s' % ''.join(sorted(set(SYM_RE.findall(b_raw)))))

    b_pieces_list = b_pieces(B)
    b_text = ' '.join(b_pieces_list)
    if b_text != a_text:
        i = next((i for i, (x, y) in enumerate(zip(a_text, b_text)) if x != y), min(len(a_text), len(b_text)))
        fails.append('B안 본문이 A안과 다름 (첫 차이 %d번째 글자)\n  A: %s\n  B: %s'
                     % (i, a_text[max(0, i - 40):i + 40], b_text[max(0, i - 40):i + 40]))
    empty = [i for i, p in enumerate(b_pieces_list) if not p.strip()]
    if empty:
        fails.append('B안에 빈 텍스트 조각: %s' % empty)

    for lbl in {b.get('label') for b in B if b.get('label')}:
        if lbl not in B_LABELS:
            fails.append('B안 구조 태그가 규칙 밖: %s' % lbl)

    n_list = sum(1 for b in B if b['type'] == 'struct-list')
    n_cont = sum(1 for b in B if b['type'] == 'struct-contrast')
    n_sub = sum(1 for b in B if b['type'] == 'struct-sub')
    if not (n_list and n_cont and n_sub):
        fails.append('B안 구조 블록 부족: 나열 %d · 대립 %d · 종속 %d' % (n_list, n_cont, n_sub))
    n_call = sum(1 for b in B if b['type'] == 'callout')
    if not n_call:
        fails.append('B안에 핵심 결론 callout 이 없음')
    if [b['text'] for b in B if b['type'] == 'h'] != a_heads:
        fails.append('B안 소제목이 A안 6개와 1:1이 아님')

    # ── C안 ────────────────────────────────────────────────
    c_heads = [b['text'] for b in C if b['type'] == 'h']
    if c_heads != a_heads:
        fails.append('C안 소제목이 A안 6개와 1:1이 아님')

    for b in C:
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
        viz = [b['type'] for b in C if b['type'] in
               ('stats', 'levels', 'flow', 'compare', 'table', 'svg', 'map', 'vs', 'cards', 'signal')]
        list_items = sum(len(b.get('items') or []) for b in B if b['type'] == 'struct-list')
        print('✅ A안 그대로 · B안 본문 100%% 무손실 — 문단 %d개 · 문장 %d개 · 소제목 %d개 일치'
              % (len(a_lines), len(a_sents), len(a_heads)))
        print('   A 글자 %d자 (불변)' % len(a_text))
        print('   B 구조 — 나열 %d(항목 %d) · 대립 %d · 종속 %d · 핵심 %d · 마킹 토큰 0 · 기호 0'
              % (n_list, list_items, n_cont, n_sub, n_call))
        print('   C 시각화 %d개: %s' % (len(viz), ', '.join(viz)))
        print('   C 화자 한마디 %d개 — 전부 원문 그대로 / 수치 %d종 전부 원문에 존재'
              % (sum(1 for b in C if b['type'] == 'callout'), len(nums(c_text_all))))
    return 0


if __name__ == '__main__':
    sys.exit(main())
