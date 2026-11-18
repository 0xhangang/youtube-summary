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

    var header = document.createElement('div');
    header.className = 'card-header';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-label', '요약 접기/펼치기: ' + (s.title || ''));

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
    header.appendChild(meta);

    var h = document.createElement('h2');
    h.className = 'video-title';
    h.textContent = s.title || '(제목 없음)';
    header.appendChild(h);

    var actions = document.createElement('div');
    actions.className = 'card-actions';
    var a = document.createElement('a');
    a.className = 'yt-link';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '▶ 유튜브에서 보기';
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
    var hint = document.createElement('span');
    hint.className = 'toggle-hint';
    hint.textContent = collapseAll ? '펼치기 ▼' : '접기 ▲';
    right.appendChild(hint);
    actions.appendChild(right);
    header.appendChild(actions);

    header.addEventListener('click', function (ev) {
      if (ev.target.closest('a')) return;
      toggleCard(card, hint);
    });
    header.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        toggleCard(card, hint);
      }
    });

    card.appendChild(header);

    var body = document.createElement('div');
    body.className = 'card-body';
    (s.blocks || []).forEach(function (b) {
      if (!b) return;
      if (b.type === 'h') {
        var st = document.createElement('div');
        st.className = 'section-title';
        st.innerHTML = rich(b.text || '');
        body.appendChild(st);
      } else if (b.type === 'ul') {
        var ulEl = document.createElement('ul');
        ulEl.className = 'bullets';
        (b.items || []).forEach(function (it2) {
          var li = document.createElement('li');
          li.innerHTML = rich(it2);
          ulEl.appendChild(li);
        });
        body.appendChild(ulEl);
      } else if (b.type === 'callout') {
        var co = document.createElement('div');
        co.className = 'callout';
        co.innerHTML = rich(b.text || '');
        body.appendChild(co);
      } else {
        var p = document.createElement('p');
        p.innerHTML = rich(b.text || '');
        body.appendChild(p);
      }
    });
    card.appendChild(body);
    return card;
  }

  function toggleCard(card, hint) {
    card.classList.toggle('collapsed');
    var c = card.classList.contains('collapsed');
    hint.textContent = c ? '펼치기 ▼' : '접기 ▲';
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
        var hint = c.querySelector('.toggle-hint');
        if (hint) hint.textContent = state.collapsedAll ? '펼치기 ▼' : '접기 ▲';
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

    // 맨 위로
    var topBtn = document.getElementById('topBtn');
    topBtn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    window.addEventListener('scroll', function () {
      topBtn.classList.toggle('show', window.scrollY > 600);
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
