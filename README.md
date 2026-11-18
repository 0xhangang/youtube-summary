# 📺 유튜브 상세 요약

관심 유튜브 채널의 자동 요약을 모아 두는 정적 아카이브입니다.
화자의 말투와 뉘앙스를 그대로 살린 상세 요약을 날짜별로 보관하고, 모바일에서 읽기 좋게 보여 줍니다.

- 사이트: https://0xhangang.github.io/youtube-summary/
- 빌드 과정 없음. `index.html` + `assets/` + `data/*.json` 만으로 동작합니다 (.nojekyll).

## 화면 기능

| 기능 | 설명 |
| --- | --- |
| 날짜 탭 | `전체` + 날짜별(최신 먼저). 앱을 열면 오늘 날짜, 오늘 요약이 없으면 가장 최근 날짜 |
| 분류 칩 | 증시·매크로 / 코인·트레이딩 / AI·사회·트렌드 … (데이터에서 자동 생성) |
| 채널 칩 | 현재 날짜 범위에 있는 채널만, 편수 많은 순 |
| 검색 | 제목·채널·분류·본문 전체를 대소문자 무시하고 검색 |
| 다크 모드 | 우측 상단 토글, `localStorage['yts.theme']`에 저장. 첫 방문은 OS 설정을 따름 |
| 읽음 표시 | 카드마다 `읽음/안 읽음` 토글, `localStorage['yts.read']`에 videoId 배열로 저장.
`안 읽은 것만` 필터와 `모두 읽음` 버튼, 제목 줄에 안 읽음 개수 표시 |
| 접기/펼치기 | 카드 머리(또는 제목)를 누르면 접힘. `모두 접기` 상태는 `yts.collapsedAll`에 저장 |
| 목차 | 현재 화면에 보이는 요약의 목차(60편 이하일 때) |
| 출처 | 카드마다 `▶ 유튜브에서 보기` 원문 링크 |

브라우저에서 `index.html`을 파일로 직접 열면 `fetch`가 막혀 데이터가 보이지 않습니다. 로컬 확인은 아래처럼 서버로 열어 주세요.

```bash
python3 -m http.server 8000 --directory .
# http://localhost:8000
```

## 구조

```
index.html                 뷰어 (데이터를 fetch 해서 그림)
assets/style.css           스타일 (라이트/다크 변수)
assets/app.js              렌더링·필터·검색·읽음 표시 (외부 라이브러리 없음)
data/index.json            날짜 목록 + 전체 마지막 업데이트 시각
data/YYYY-MM-DD.json       그날의 요약들
scripts/add_summaries.py   요약 추가 도구 (아래 참고)
.nojekyll                  GitHub Pages가 파일을 그대로 서빙하도록
```

## 데이터 형식

### data/index.json

```json
{
  "site": "📺 유튜브 상세 요약",
  "updatedAt": "2026-11-18T23:10:00+09:00",
  "dates": [
    {
      "date": "2026-11-17",
      "label": "2026년 11월 17일 화요일",
      "count": 6,
      "file": "data/2026-11-17.json"
    }
  ]
}
```

`dates`는 최신 날짜가 먼저 오도록 정렬합니다. `count`는 그날 요약 편수입니다.

### data/YYYY-MM-DD.json

```json
{
  "date": "2026-11-17",
  "label": "2026년 11월 17일 화요일",
  "updatedAt": "2026-11-17T21:10:00+09:00",
  "summaries": [
    {
      "id": "B9wFQa1x82w",
      "videoId": "B9wFQa1x82w",
      "url": "https://www.youtube.com/watch?v=B9wFQa1x82w",
      "channel": "홍장원의 불앤베어",
      "category": "stock",
      "categoryLabel": "증시·매크로",
      "title": "[속보] 발빠른 드러켄밀러, 반도체 미리 다 팔았나",
      "kind": "video",
      "publishedAt": "2026-11-17T21:00:00+09:00",
      "addedAt": "2026-11-17T21:10:00+09:00",
      "blocks": [
        { "type": "h", "text": "🏃‍♂️ 외부 일정 중 짧은 속보: …" },
        { "type": "p", "text": "네, 지금 외부에 있어서 … **반도체 주식을 거의 다 팔았습니다.**" },
        { "type": "ul", "items": ["**삼성전자·SK하이닉스**: …", "**한화오션·APR**: …"] },
        { "type": "callout", "text": "정리하자면 …" }
      ]
    }
  ]
}
```

- `videoId` — 고유 키. 읽음 표시도 이 값을 씁니다.
- `category` — `stock` / `coin` / `trend` / `tech` / `economy` / `etc`. `categoryLabel`이 없으면 자동 라벨을 씁니다.
- `blocks` — 본문. `type`은 `h`(소제목), `p`(문단), `ul`(불릿), `callout`(강조 상자).
본문 텍스트의 `**굵게**`만 서식으로 변환되고 나머지는 그대로 출력됩니다(HTML 태그 무시).
- `summaries` 배열 순서가 화면 순서입니다. 그날 안에서는 도착 순서대로 뒤에 붙입니다.
- 선택 필드: `kind`(`video`/`short`/`live`), `duration`, `publishedAt`, `channelId`.

## 새 요약 붙이기 (스케줄 액션이 쓰는 방법)

`scripts/add_summaries.py`가 날짜 파일에 요약을 붙이고 `index.json`을 다시 만듭니다.

```bash
# 1) 새 요약을 JSON으로 쓴다 (blocks 대신 줄글 text도 가능)
cat > /tmp/new.json <<'JSON'
{
  "date": "2026-11-18",
  "summaries": [
    {
      "videoId": "AAAAAAAAAAA",
      "channel": "알상무",
      "category": "stock",
      "title": "지표추적자 1118",
      "text": "## 오전 시황\n안녕하세요, 11월 18일 …\n\n둘째 문단입니다. **중요한 숫자**는 이렇게.\n\n- 첫째 항목\n- 둘째 항목\n\n> 마무리 한마디"
    }
  ]
}
JSON

# 2) 데이터에 반영 (같은 videoId는 기본적으로 건너뜀, --replace로 갱신)
python3 scripts/add_summaries.py /tmp/new.json

# 3) 확인 후 커밋·푸시 — Pages가 1분 안에 자동 반영
git add -A && git commit -m "요약 추가: 2026-11-18 (N편)" && git push
```

`text` 필드 변환 규칙: `##`/`###` → 소제목, `-`/`*` → 불릿, `>` → 강조 상자, 빈 줄로 나뉜 덩어리 → 문단.
편수·날짜 집계는 스크립트가 다시 계산하므로 손으로 `index.json`을 고칠 필요가 없습니다.

수동으로 JSON을 직접 고쳐도 됩니다. 새 날짜 파일을 추가했다면 `data/index.json`의 `dates`에 항목을 넣어 주세요.

## 로컬 저장 키

| 키 | 내용 |
| --- | --- |
| `yts.theme` | `light` / `dark` |
| `yts.read` | 읽은 영상 videoId 배열 |
| `yts.collapsedAll` | `1`이면 모두 접힌 상태로 열림 |
