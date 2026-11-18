/* 유튜브 상세 요약 — 정적 뷰어
 * 데이터: data/index.json + data/YYYY-MM-DD.json
 * 앱은 오직 읽기만 한다. 새 요약은 데이터 파일을 추가/수정해서 붙인다.
 */
(function () {
  'use strict';

  var INDEX_URL = 'data/index.json';
  var LS_THEME = 'yts.theme';
  var LS_READ = 'yts.read';
  var LS_COLLAPSED = 'yts.collapsedAll';

  var CAT_ORDER = ['stock', 'coin', 'trend', 'tech', 'economy', 'etc'];

  var state = {
    index: null,
    activeDate: null,
    cache: Object.create(null),   // date -> Promise<doc>
    docs: Object.create(null),    // date -> doc
    cat: 'all',
    channel: 'all',
    q: '',
    unreadOnly: false,
    read: loadRead(),
    collapsedAll: false
  };

  var dom = {};
  var searchTimer = null;

  /* ── 저장소 ─────────────────────────────────────────── */
  function loadRead() {
    try {
      var raw = localStorage.getItem(LS_READ);
      var arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (e) {
      return new Set();
    }
  }
  function saveRead() {
    try {
      localStorage.setItem(LS_READ, JSON.stringify(Array.from(state.read)));
    } catch (e) {}
  }

  /* ── 유틸 ──────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  // **굵게** 만 허용하는 최소 서식
  function rich(s) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }
  function fmtDateLabel(iso) {
    // "2026-11-17" -> "11.17 (화)"
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return Number(m[2]) + '.' + m[3] + ' (' + wd + ')';
  }
  function fmtStamp(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function todayISO() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function fmtToday() {
    var d = new Date();
    var wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + wd + '요일';
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // ISO 시각을 한국 시간(KST) 기준 조각으로 — 보는 사람의 시간대와 무관하게
  function kstParts(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    try {
      var parts = {};
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
      return {
        y: parts.year, m: parts.month, d: parts.day,
        hh: parts.hour === '24' ? '00' : parts.hour, mm: parts.minute
      };
    } catch (e) {
      return {
        y: String(d.getFullYear()), m: pad2(d.getMonth() + 1), d: pad2(d.getDate()),
        hh: pad2(d.getHours()), mm: pad2(d.getMinutes())
      };
    }
  }
  // "11.17 14:01" (해가 다르면 "2025.11.17 14:01")
  function fmtPublished(iso) {
    var p = kstParts(iso);
    if (!p) return '';
    var thisYear = String(new Date().getFullYear());
    return (p.y === thisYear ? '' : p.y + '.') + Number(p.m) + '.' + p.d + ' ' + p.hh + ':' + p.mm;
  }

  // 초 단위 길이. 숫자(초) 또는 "1:12:22" / "12:22" 문자열을 모두 받는다
  function durSeconds(v) {
    if (typeof v === 'number' && isFinite(v) && v > 0) return Math.round(v);
    if (typeof v === 'string') {
      var t = v.trim();
      if (/^\d+$/.test(t)) return Number(t);
      var m = /^(?:(\d+):)?(\d{1,3}):(\d{2})$/.exec(t);
      if (m) return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
    return 0;
  }
  function fmtClock(sec) {
    if (!sec) return '';
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
  }
  function fmtDurKo(sec) {
    if (!sec) return '';
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return h + '시간' + (m ? ' ' + m + '분' : '');
    if (m) return m + '분' + (s ? ' ' + s + '초' : '');
    return s + '초';
  }

  // 썸네일 후보 목록 — 앞에서부터 시도하고 실패하면 다음 것으로 넘어간다
  function thumbChain(s, id) {
    var out = [];
    var t = (s.thumbnail || '').trim();
    var isYt = /^https?:\/\/i\d?\.ytimg\.com\/vi\//.test(t);
    if (t && !isYt) out.push(t);            // 직접 넣은 썸네일은 그대로 최우선
    if (id && /^[A-Za-z0-9_-]{6,}$/.test(id)) {
      out.push('https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg');
    }
    if (t) out.push(t);
    if (id) {
      out.push('https://i.ytimg.com/vi/' + id + '/mqdefault.jpg');
      out.push('https://i.ytimg.com/vi/' + id + '/hqdefault.jpg');
    }
    var seen = Object.create(null);
    return out.filter(function (u) {
      if (!u || seen[u]) return false;
      seen[u] = true;
      return true;
    });
  }

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error(url + ' → HTTP ' + res.status);
      return res.json();
    });
  }

  function summaryText(s) {
    if (typeof s.plain === 'string' && s.plain) return s.plain;
    var out = [];
    (s.blocks || []).forEach(function (b) {
      if (b.text) out.push(b.text);
      if (b.items) out.push(b.items.join(' '));
    });
    return out.join(' ');
  }

  /* ── 데이터 ────────────────────────────────────────── */
  function loadIndex() {
    return fetchJSON(INDEX_URL).then(function (idx) {
      if (!idx || !Array.isArray(idx.dates)) throw new Error('index.json 형식이 올바르지 않습니다');
      idx.dates = idx.dates.slice().sort(function (a, b) {
        return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
      });
      state.index = idx;
      return idx.dates;
    });
  }

  function loadDate(date) {
    if (state.docs[date]) return Promise.resolve(state.docs[date]);
    if (state.cache[date]) return state.cache[date];
    var meta = null;
    state.index.dates.forEach(function (d) { if (d.date === date) meta = d; });
    var url = (meta && meta.file) ? meta.file : 'data/' + date + '.json';
    var p = fetchJSON(url).then(function (doc) {
      if (!doc || !Array.isArray(doc.summaries)) throw new Error(url + ' 형식이 올바르지 않습니다');
      state.docs[date] = doc;
      return doc;
    });
    p.catch(function () { delete state.cache[date]; });
    state.cache[date] = p;
    return p;
  }

  function scopeOf(date) {
    // [{summary, date}] — 항상 최신 날짜 먼저, 같은 날짜에서는 파일 순서 유지
    var dates = date === 'all' ? state.index.dates.map(function (d) { return d.date; }) : [date];
    var out = [];
    dates.forEach(function (d) {
      var doc = state.docs[d];
      if (!doc) return;
      doc.summaries.forEach(function (s) {
        out.push({ s: s, date: d, dateLabel: doc.label || fmtDateLabel(d) });
      });
    });
    return out;
  }

  /* ── 칩 ───────────────────────────────────────────── */
  function renderDateChips() {
    var box = dom.dateChips;
    box.innerHTML = '';
    var total = 0;
    state.index.dates.forEach(function (d) { total += Number(d.count || 0); });
    var all = document.createElement('button');
    all.type = 'button';
    all.className = 'chip' + (state.activeDate === 'all' ? ' active' : '');
    all.innerHTML = '전체 <span class="n">(' + total + ')</span>';
    all.addEventListener('click', function () { setDate('all'); });
    box.appendChild(all);

    state.index.dates.forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.activeDate === d.date ? ' active' : '');
      b.innerHTML = esc(fmtDateLabel(d.date)) + ' <span class="n">(' + Number(d.count || 0) + ')</span>';
      b.addEventListener('click', function () { setDate(d.date); });
      box.appendChild(b);
    });
  }

  function renderFilterChips(all) {
    // 분류
    var cats = {};
    var chans = {};
    all.forEach(function (it) {
      var c = it.s.category || 'etc';
      cats[c] = (cats[c] || 0) + 1;
      var ch = it.s.channel || '기타';
      chans[ch] = (chans[ch] || 0) + 1;
    });

    var catBox = dom.catChips;
    catBox.innerHTML = '';
    var allChip = document.createElement('button');
    allChip.type = 'button';
    allChip.className = 'chip' + (state.cat === 'all' ? ' active' : '');
    allChip.innerHTML = '전체 분류 <span class="n">(' + all.length + ')</span>';
    allChip.addEventListener('click', function () { state.cat = 'all'; apply(); });
    catBox.appendChild(allChip);

    var keys = Object.keys(cats).sort(function (a, b) {
      var ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      if (ia < 0) ia = 99;
      if (ib < 0) ib = 99;
      return ia - ib;
    });
    keys.forEach(function (k) {
      var label = catLabel(k, all);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.cat === k ? ' active' : '');
      b.innerHTML = esc(label) + ' <span class="n">(' + cats[k] + ')</span>';
      b.addEventListener('click', function () { state.cat = k; apply(); });
      catBox.appendChild(b);
    });

    // 채널
    var chBox = dom.channelChips;
    chBox.innerHTML = '';
    var names = Object.keys(chans).sort(function (a, b) { return chans[b] - chans[a]; });
    if (names.length > 1) {
      var b0 = document.createElement('button');
      b0.type = 'button';
      b0.className = 'chip channel' + (state.channel === 'all' ? ' active' : '');
      b0.innerHTML = '모든 채널 <span class="n">(' + all.length + ')</span>';
      b0.addEventListener('click', function () { state.channel = 'all'; apply(); });
      chBox.appendChild(b0);
      names.forEach(function (n) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip channel' + (state.channel === n ? ' active' : '');
        b.textContent = n;
        b.addEventListener('click', function () { state.channel = n; apply(); });
        chBox.appendChild(b);
      });
    }
  }

  function catLabel(key, all) {
    for (var i = 0; i < all.length; i++) {
      if ((all[i].s.category || 'etc') === key && all[i].s.categoryLabel) return all[i].s.categoryLabel;
    }
    var map = {
      stock: '증시·매크로', coin: '코인·트레이딩', trend: 'AI·사회·트렌드',
      tech: '테크', economy: '경제', etc: '기타'
    };
    return map[key] || key;
  }

  /* ── 카드 ──────────────────────────────────────────── */
  function buildCard(it, collapseAll) {
    var s = it.s;
    var id = s.videoId || s.id || (it.date + '-' + s.title);
    var card = document.createElement('article');
    card.className = 'card';
    card.id = 'v-' + String(id).replace(/[^A-Za-z0-9_-]/g, '');
    card.dataset.vid = id;
    if (state.read.has(id)) card.classList.add('read');
    if (collapseAll) card.classList.add('collapsed');

    var url = s.url || ('https://www.youtube.com/watch?v=' + id);
    var dur = durSeconds(s.duration);
    var pub = fmtPublished(s.publishedAt);

    var header = document.createElement('div');
    header.className = 'card-header';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', collapseAll ? 'false' : 'true');
    header.setAttribute('aria-label', '요약 접기/펼치기: ' + (s.title || ''));

    // 썸네일 — 펼치면 16:9 배너, 접으면 옆의 작은 그림
    var chain = thumbChain(s, id);
    if (chain.length) {
      var thumbLink = document.createElement('a');
      thumbLink.className = 'thumb';
      thumbLink.href = url;
      thumbLink.target = '_blank';
      thumbLink.rel = 'noopener';
      thumbLink.setAttribute('aria-label', '유튜브에서 영상 열기: ' + (s.title || ''));

      var img = document.createElement('img');
      img.className = 'thumb-img';
      img.alt = (s.title || '영상') + ' 썸네일';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      var ci = 0;
      img.addEventListener('error', function () {
        ci++;
        if (ci < chain.length) { img.src = chain[ci]; return; }
        // 모든 후보 실패 → 그림 없이 글만
        card.classList.add('no-thumb');
        if (thumbLink.parentNode) thumbLink.parentNode.removeChild(thumbLink);
      });
      img.src = chain[0];
      thumbLink.appendChild(img);

      var play = document.createElement('span');
      play.className = 'thumb-play';
      var glyph = document.createElement('span');
      glyph.className = 'thumb-play-glyph';
      glyph.textContent = '▶';
      play.appendChild(glyph);
      thumbLink.appendChild(play);

      if (dur) {
        var dBadge = document.createElement('span');
        dBadge.className = 'thumb-dur';
        dBadge.textContent = fmtClock(dur);
        dBadge.title = fmtDurKo(dur);
        thumbLink.appendChild(dBadge);
      }
      header.appendChild(thumbLink);
    }

    var main = document.createElement('div');
    main.className = 'card-main';

    var meta = document.createElement('div');
    meta.className = 'meta-row';
    var badge = document.createElement('span');
    badge.className = 'channel-badge';
    badge.textContent = s.channel || '채널';
    meta.appendChild(badge);
    if (s.categoryLabel) {
      var tag = document.createElement('span');
      tag.className = 'cat-tag';
      tag.textContent = s.categoryLabel;
      meta.appendChild(tag);
    }
    var dot = document.createElement('span');
    dot.className = 'unread-dot';
    dot.title = '안 읽음';
    meta.appendChild(dot);
    main.appendChild(meta);

    var h = document.createElement('h2');
    h.className = 'video-title';
    h.textContent = s.title || '(제목 없음)';
    main.appendChild(h);

    // 메타 줄(업로드 시각·길이)과 동작 줄을 한 줄에 묶어 카드 머리를 세 줄로 정리
    var subRow = document.createElement('div');
    subRow.className = 'sub-row';

    if (pub || dur) {
      var line = document.createElement('div');
      line.className = 'meta-line';
      if (pub) {
        var sp = document.createElement('span');
        sp.className = 'mi mi-pub';
        sp.textContent = pub;
        sp.title = '업로드 ' + pub + ' (한국시간)';
        line.appendChild(sp);
      }
      if (dur) {
        var sd = document.createElement('span');
        sd.className = 'mi mi-dur';
        sd.textContent = fmtDurKo(dur);
        sd.title = '영상 길이 ' + fmtClock(dur);
        line.appendChild(sd);
      }
      subRow.appendChild(line);
    }

    var actions = document.createElement('div');
    actions.className = 'card-actions';
    var a = document.createElement('a');
    a.className = 'yt-link';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = '유튜브에서 보기';
    var aIco = document.createElement('span');
    aIco.className = 'yt-ico';
    aIco.textContent = '▶';
    aIco.setAttribute('aria-hidden', 'true');
    a.appendChild(aIco);
    a.appendChild(document.createTextNode('유튜브에서 보기'));
    actions.appendChild(a);

    var right = document.createElement('span');
    right.className = 'actions-right';
    var readBtn = document.createElement('button');
    readBtn.type = 'button';
    readBtn.className = 'read-btn';
    readBtn.textContent = state.read.has(id) ? '✓ 읽음' : '안 읽음';
    readBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      toggleRead(id, card, readBtn);
    });
    right.appendChild(readBtn);
    var chev = document.createElement('span');
    chev.className = 'chev';
    chev.setAttribute('aria-hidden', 'true');
    right.appendChild(chev);
    actions.appendChild(right);
    subRow.appendChild(actions);
    main.appendChild(subRow);
    header.appendChild(main);

    header.addEventListener('click', function (ev) {
      if (ev.target.closest('a')) return;
      toggleCard(card);
    });
    header.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        toggleCard(card);
      }
    });

    card.appendChild(header);

    var body = document.createElement('div');
    body.className = 'card-body';
    var inner = document.createElement('div');
    inner.className = 'body-inner';
    (s.blocks || []).forEach(function (b) {
      if (!b) return;
      if (b.type === 'h') {
        var st = document.createElement('div');
        st.className = 'section-title';
        st.innerHTML = rich(b.text || '');
        inner.appendChild(st);
      } else if (b.type === 'ul') {
        var ulEl = document.createElement('ul');
        ulEl.className = 'bullets';
        (b.items || []).forEach(function (it2) {
          var li = document.createElement('li');
          li.innerHTML = rich(it2);
          ulEl.appendChild(li);
        });
        inner.appendChild(ulEl);
      } else if (b.type === 'callout') {
        var co = document.createElement('div');
        co.className = 'callout';
        co.innerHTML = rich(b.text || '');
        inner.appendChild(co);
      } else {
        var p = document.createElement('p');
        p.innerHTML = rich(b.text || '');
        inner.appendChild(p);
      }
    });
    body.appendChild(inner);
    card.appendChild(body);
    return card;
  }

  function toggleCard(card) {
    var collapsed = card.classList.toggle('collapsed');
    var header = card.querySelector('.card-header');
    if (header) header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  function toggleRead(id, card, btn) {
    if (state.read.has(id)) state.read.delete(id);
    else state.read.add(id);
    saveRead();
    card.classList.toggle('read', state.read.has(id));
    btn.textContent = state.read.has(id) ? '✓ 읽음' : '안 읽음';
    if (state.unreadOnly && state.read.has(id)) apply();
    else updateSubtitle(counts.lastScope);
  }

  /* ── 렌더 ──────────────────────────────────────────── */
  var counts = { lastScope: 0 };

  function apply() {
    var all = scopeOf(state.activeDate);
    counts.lastScope = all.length;
    renderFilterChips(all);

    var q = state.q.trim().toLowerCase();
    var filtered = all.filter(function (it) {
      var s = it.s;
      if (state.cat !== 'all' && (s.category || 'etc') !== state.cat) return false;
      if (state.channel !== 'all' && (s.channel || '기타') !== state.channel) return false;
      if (state.unreadOnly) {
        var id = s.videoId || s.id;
        if (state.read.has(id)) return false;
      }
      if (q) {
        var hay = ((s.title || '') + ' ' + (s.channel || '') + ' ' +
          (s.categoryLabel || '') + ' ' + (s.plain || summaryText(s))).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });

    var feed = dom.feed;
    feed.innerHTML = '';
    if (!filtered.length) {
      var none = document.createElement('div');
      none.className = 'state';
      none.textContent = all.length
        ? '조건에 맞는 요약이 없어요. 필터를 바꿔 보세요.'
        : '이 날짜에는 아직 요약이 없어요.';
      feed.appendChild(none);
      updateToc(filtered);
      updateSubtitle(all.length);
      return;
    }

    var lastDate = null;
    filtered.forEach(function (it) {
      if (state.activeDate === 'all' && it.date !== lastDate) {
        var div = document.createElement('div');
        div.className = 'date-divider';
        div.textContent = it.dateLabel || fmtDateLabel(it.date);
        feed.appendChild(div);
        lastDate = it.date;
      }
      feed.appendChild(buildCard(it, state.collapsedAll));
    });

    updateToc(filtered);
    updateSubtitle(all.length);
  }

  function updateSubtitle(scopeCount) {
    if (!state.index) return;
    var label;
    if (state.activeDate === 'all') {
      label = '전체 아카이브 · ' + state.index.dates.length + '일';
    } else {
      var meta = null;
      state.index.dates.forEach(function (d) { if (d.date === state.activeDate) meta = d; });
      label = (meta && meta.label) || fmtDateLabel(state.activeDate);
    }
    var unread = 0;
    var all = scopeOf(state.activeDate);
    all.forEach(function (it) {
      var id = it.s.videoId || it.s.id;
      if (!state.read.has(id)) unread++;
    });
    var parts = [label, (scopeCount != null ? scopeCount : all.length) + '편'];
    if (unread) parts.push('안 읽음 ' + unread);
    dom.subtitle.textContent = parts.join(' · ');
  }

  function updateToc(filtered) {
    var list = dom.tocList;
    list.innerHTML = '';
    if (!filtered || !filtered.length || filtered.length > 60) {
      dom.tocBox.hidden = true;
      return;
    }
    dom.tocBox.hidden = false;
    dom.tocTitle.textContent = '📑 목차 (' + filtered.length + '편)';
    filtered.forEach(function (it) {
      var s = it.s;
      var id = s.videoId || s.id;
      var anchor = 'v-' + String(id).replace(/[^A-Za-z0-9_-]/g, '');
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + anchor;
      var ch = document.createElement('span');
      ch.className = 'toc-channel';
      ch.textContent = s.channel || '';
      a.appendChild(ch);
      a.appendChild(document.createTextNode(' ' + (s.title || '')));
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  function renderFooter() {
    var parts = [];
    if (state.index.updatedAt) parts.push('마지막 업데이트 ' + fmtStamp(state.index.updatedAt));
    var total = 0;
    state.index.dates.forEach(function (d) { total += Number(d.count || 0); });
    parts.push(state.index.dates.length + '일 · ' + total + '편');
    dom.footerMeta.textContent = parts.join(' · ') + ' · 오늘 ' + fmtToday();
  }

  function fail(err) {
    console.error(err);
    dom.feed.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'state';
    box.innerHTML = '요약 데이터를 불러오지 못했어요.<br>' +
      '<span style="font-size:12.5px;opacity:.8">' + esc(String(err && err.message || err)) + '</span>' +
      '<br><button class="btn retry" type="button">다시 시도</button>' +
      '<div style="font-size:12px;margin-top:14px;opacity:.75">' +
      'index.html을 파일로 직접 열었다면 브라우저가 데이터 읽기를 막습니다. ' +
      '인터넷 주소(https://0xhangang.github.io/youtube-summary/)로 열어 주세요.</div>';
    dom.feed.appendChild(box);
    dom.subtitle.textContent = '불러오기 실패';
    var rb = box.querySelector('.retry');
    if (rb) rb.addEventListener('click', function () { boot(); });
  }

  function setDate(date) {
    state.activeDate = date;
    state.cat = 'all';
    state.channel = 'all';
    dom.unreadOnly.checked = state.unreadOnly;
    renderDateChips();
    dom.subtitle.textContent = '불러오는 중…';
    dom.feed.innerHTML = '<div class="state">불러오는 중…</div>';

    var job;
    if (date === 'all') {
      job = Promise.all(state.index.dates.map(function (d) { return loadDate(d.date); }));
    } else {
      job = loadDate(date);
    }
    job.then(function () {
      apply();
      renderFooter();
    }).catch(fail);
  }

  /* ── 초기화 ────────────────────────────────────────── */
  function wire() {
    dom.subtitle = document.getElementById('subtitle');
    dom.dateChips = document.getElementById('dateChips');
    dom.catChips = document.getElementById('catChips');
    dom.channelChips = document.getElementById('channelChips');
    dom.feed = document.getElementById('feed');
    dom.tocBox = document.getElementById('tocBox');
    dom.tocTitle = document.getElementById('tocTitle');
    dom.tocList = document.getElementById('tocList');
    dom.footerMeta = document.getElementById('footerMeta');
    dom.search = document.getElementById('search');
    dom.unreadOnly = document.getElementById('unreadOnly');

    // 테마
    var themeBtn = document.getElementById('themeBtn');
    function syncThemeBtn() {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      themeBtn.textContent = dark ? '☀️ 라이트' : '🌙 다크';
    }
    syncThemeBtn();
    themeBtn.addEventListener('click', function () {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      var next = dark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(LS_THEME, next); } catch (e) {}
      syncThemeBtn();
    });

    // 모두 접기/펼치기
    var toggleAllBtn = document.getElementById('toggleAllBtn');
    function syncToggleAll() {
      toggleAllBtn.textContent = state.collapsedAll ? '모두 펼치기' : '모두 접기';
    }
    try { state.collapsedAll = localStorage.getItem(LS_COLLAPSED) === '1'; } catch (e) {}
    syncToggleAll();
    toggleAllBtn.addEventListener('click', function () {
      state.collapsedAll = !state.collapsedAll;
      try { localStorage.setItem(LS_COLLAPSED, state.collapsedAll ? '1' : '0'); } catch (e) {}
      syncToggleAll();
      Array.prototype.forEach.call(document.querySelectorAll('.card'), function (c) {
        c.classList.toggle('collapsed', state.collapsedAll);
        var head = c.querySelector('.card-header');
        if (head) head.setAttribute('aria-expanded', state.collapsedAll ? 'false' : 'true');
      });
    });

    // 검색
    dom.search.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.q = dom.search.value || '';
        apply();
      }, 120);
    });

    // 안 읽은 것만
    dom.unreadOnly.addEventListener('change', function () {
      state.unreadOnly = dom.unreadOnly.checked;
      apply();
    });

    // 모두 읽음 (현재 날짜 범위)
    document.getElementById('markAllBtn').addEventListener('click', function () {
      var all = scopeOf(state.activeDate);
      all.forEach(function (it) {
        var id = it.s.videoId || it.s.id;
        state.read.add(id);
      });
      saveRead();
      apply();
    });

    // 맨 위로 + 스크롤 방향에 따라 헤더 감추기
    var topBtn = document.getElementById('topBtn');
    var siteHeader = document.getElementById('siteHeader');
    var lastY = window.scrollY;
    topBtn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    window.addEventListener('scroll', function () {
      var y = window.scrollY;
      topBtn.classList.toggle('show', y > 600);
      if (siteHeader) {
        if (y < 140) siteHeader.classList.remove('hide');
        else if (y > lastY + 6) siteHeader.classList.add('hide');
        else if (y < lastY - 6) siteHeader.classList.remove('hide');
      }
      lastY = y;
    }, { passive: true });
  }

  function boot() {
    loadIndex().then(function (dates) {
      if (!dates.length) {
        dom.subtitle.textContent = '요약 없음';
        dom.feed.innerHTML = '<div class="state">아직 등록된 요약이 없어요.</div>';
        return;
      }
      var hasToday = dates.some(function (d) { return d.date === todayISO(); });
      setDate(hasToday ? todayISO() : dates[0].date);
    }).catch(fail);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { wire(); boot(); });
  } else {
    wire();
    boot();
  }
})();
