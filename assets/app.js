/* 피클 유튜브 요약 — 정적 뷰어
 * 데이터: data/index.json + data/channels.json + data/YYYY-MM-DD.json
 */
(function () {
  'use strict';

  var INDEX_URL = 'data/index.json';
  var CHANNELS_URL = 'data/channels.json';
  var LS_THEME = 'yts.theme';
  var LS_SORT = 'yts.sort';
  var LS_LIKES = 'yts.likes';
  var LS_READ = 'yts.read';
  var PAGE_SIZE = 20;
  var CAT_ORDER = ['stock', 'coin', 'trend', 'tech', 'economy', 'life', 'etc'];
  var AVATAR_COLORS = ['#10b981', '#2563eb', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#db2777'];

  var state = {
    index: null,
    avatars: Object.create(null),
    activeDate: null,
    cache: Object.create(null),
    docs: Object.create(null),
    cat: 'all',
    channel: 'all',
    channelScope: 'all', // 'all' | 'watched' | 'single'
    favOnly: false,
    readOnly: false,
    q: '',
    likes: loadLikes(),
    reads: loadReads(),
    sort: loadSort(),
    activeTab: 'toc', // 'cat' | 'channel' | 'toc' | 'read' | 'fav' | 'search' | null
    singleMode: null // { date, videoId }
  };

  var dom = {};
  var searchTimer = null;

  function loadLikes() {
    try {
      var raw = localStorage.getItem(LS_LIKES);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') return obj;
      }
    } catch (e) {}
    return {};
  }
  function saveLikes() {
    try { localStorage.setItem(LS_LIKES, JSON.stringify(state.likes)); } catch (e) {}
  }
  function isLiked(id) {
    return Boolean(id && state.likes[id]);
  }
  function toggleLike(id) {
    if (!id) return false;
    if (state.likes[id]) delete state.likes[id];
    else state.likes[id] = true;
    saveLikes();
    return Boolean(state.likes[id]);
  }

  function loadReads() {
    var merged = {};
    try {
      var raw = localStorage.getItem(LS_READ);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') {
          Object.keys(obj).forEach(function (k) { if (obj[k]) merged[k] = true; });
        }
      }
    } catch (e) {}
    try {
      var m = document.cookie.match(/(?:^|;\s*)yts_read=([^;]*)/);
      if (m && m[1]) {
        decodeURIComponent(m[1]).split(',').forEach(function (id) {
          if (id) merged[id] = true;
        });
      }
    } catch (e) {}
    return merged;
  }
  function saveReads() {
    try { localStorage.setItem(LS_READ, JSON.stringify(state.reads)); } catch (e) {}
    try {
      var ids = Object.keys(state.reads).filter(function (k) { return state.reads[k]; }).slice(-120);
      var exp = new Date(Date.now() + 365 * 864e5).toUTCString();
      document.cookie = 'yts_read=' + encodeURIComponent(ids.join(',')) + '; expires=' + exp + '; path=/; SameSite=Lax';
    } catch (e) {}
  }
  function isRead(id) {
    return Boolean(id && state.reads[id]);
  }
  function toggleRead(id) {
    if (!id) return false;
    if (state.reads[id]) delete state.reads[id];
    else state.reads[id] = true;
    saveReads();
    return Boolean(state.reads[id]);
  }

  function loadSort() {
    try {
      var s = localStorage.getItem(LS_SORT);
      if (s === 'newest' || s === 'oldest') return s;
    } catch (e) {}
    return 'newest';
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
  function escRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  function highlightHtml(safeHtml, q) {
    if (!q) return safeHtml;
    var re = new RegExp('(' + escRe(esc(q)) + ')', 'gi');
    return safeHtml.replace(/(<[^>]+>)|([^<]+)/g, function (_, tag, text) {
      if (tag) return tag;
      return text.replace(re, '<mark class="hl">$1</mark>');
    });
  }
  function rich(s, q) {
    var html = esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return q ? highlightHtml(html, q) : html;
  }
  // 긴 문단을 모바일에서 읽기 편하게 2~3문장 단위로 자연 분할
  function splitParagraph(text) {
    var t = String(text || '').trim();
    if (t.length < 210) return [t];
    var parts = t.split(/(?<=[.?!])\s+(?=[가-힣A-Za-z0-9"'(\[])/);
    if (parts.length <= 2) return [t];
    var out = [];
    var buf = '';
    var count = 0;
    for (var i = 0; i < parts.length; i++) {
      buf = buf ? (buf + ' ' + parts[i]) : parts[i];
      count++;
      if ((count >= 2 && buf.length >= 130) || count >= 3) {
        out.push(buf);
        buf = '';
        count = 0;
      }
    }
    if (buf) {
      if (out.length && buf.length < 55) out[out.length - 1] += ' ' + buf;
      else out.push(buf);
    }
    return out.length ? out : [t];
  }
  function fmtDateLabel(iso) {
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
  function fmtPublished(iso) {
    var p = kstParts(iso);
    if (!p) return '';
    var thisYear = String(new Date().getFullYear());
    return (p.y === thisYear ? '' : p.y + '.') + Number(p.m) + '.' + p.d + ' ' + p.hh + ':' + p.mm;
  }
  function fmtRelative(iso) {
    if (!iso) return '';
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var diffMin = Math.floor((Date.now() - t) / 60000);
    if (diffMin < 1) return '방금 전';
    if (diffMin < 60) return diffMin + '분 전';
    var diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + '시간 전';
    var diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return diffDay + '일 전';
    return '';
  }

  function thumbChain(s, id) {
    var out = [];
    var t = (s.thumbnail || '').trim();
    var isYt = /^https?:\/\/i\d?\.ytimg\.com\/vi\//.test(t);
    if (t && !isYt) out.push(t);
    if (id && /^[A-Za-z0-9_-]{6,}$/.test(id)) {
      out.push('https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg');
      out.push('https://i.ytimg.com/vi/' + id + '/sddefault.jpg');
    }
    if (t) out.push(t);
    if (id) {
      out.push('https://i.ytimg.com/vi/' + id + '/hqdefault.jpg');
      out.push('https://i.ytimg.com/vi/' + id + '/mqdefault.jpg');
    }
    var seen = Object.create(null);
    return out.filter(function (u) {
      if (!u || seen[u]) return false;
      seen[u] = true;
      return true;
    });
  }

  function avatarColor(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  }

  function getChannelAvatar(name) {
    var entry = state.avatars[name];
    if (!entry) return '';
    return typeof entry === 'string' ? entry : (entry.avatar || '');
  }

  function getChannelUrl(name) {
    var entry = state.avatars[name];
    if (entry && typeof entry === 'object' && entry.url) return entry.url;
    return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(name || '');
  }

  function makeAvatarEl(channelName, small) {
    var name = channelName || '채널';
    var url = getChannelAvatar(name);
    var wrap = document.createElement('span');
    wrap.className = small ? 'ch-av ch-av-sm' : 'ch-av';
    if (url) {
      var img = document.createElement('img');
      img.src = url;
      img.alt = name;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', function () {
        wrap.innerHTML = '';
        wrap.style.background = avatarColor(name);
        wrap.textContent = name.slice(0, 1);
      });
      wrap.appendChild(img);
    } else {
      wrap.style.background = avatarColor(name);
      wrap.textContent = name.slice(0, 1);
    }
    return wrap;
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

  function sortTime(s) {
    var v = s.publishedAt || s.addedAt || '';
    var t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }

  /* ── 데이터 ────────────────────────────────────────── */
  function loadAvatars() {
    return fetchJSON(CHANNELS_URL).then(function (map) {
      if (map && typeof map === 'object') state.avatars = map;
    }).catch(function () {});
  }

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

  function sortItems(list) {
    var mode = state.sort;
    return list.slice().sort(function (a, b) {
      if (mode === 'oldest') return sortTime(a.s) - sortTime(b.s);
      return sortTime(b.s) - sortTime(a.s);
    });
  }

  /* ── 탭 제어 (분류 · 채널 · 목차 · 읽음 · 좋아요 · 검색) ───────── */
  function setTab(tabName) {
    var next = (state.activeTab === tabName) ? (tabName === 'toc' ? null : 'toc') : tabName;
    var prevFav = state.favOnly;
    var prevRead = state.readOnly;
    state.activeTab = next;
    state.favOnly = (next === 'fav');
    state.readOnly = (next === 'read');
    syncTabs();
    if (state.favOnly) {
      loadAllDatesIf(state.likes).then(function () { apply(); });
    } else if (state.readOnly) {
      loadAllDatesIf(state.reads).then(function () { apply(); });
    } else if (prevFav !== state.favOnly || prevRead !== state.readOnly) {
      apply();
    }
    if (next === 'search') {
      loadAllDates();
    }
  }

  function syncTabs() {
    var t = state.activeTab;
    var btns = [
      { id: 'tabBtnDate', key: 'date', pane: 'paneDate' },
      { id: 'tabBtnToc', key: 'toc', pane: 'paneToc' },
      { id: 'tabBtnCat', key: 'cat', pane: 'paneCat' },
      { id: 'tabBtnChannel', key: 'channel', pane: 'paneChannel' },
      { id: 'tabBtnRead', key: 'read', pane: 'paneRead' },
      { id: 'tabBtnFav', key: 'fav', pane: 'paneFav' },
      { id: 'tabBtnSearch', key: 'search', pane: 'paneSearch' }
    ];
    dom.tabPanel.hidden = !t;
    btns.forEach(function (b) {
      var btn = document.getElementById(b.id);
      var pane = document.getElementById(b.pane);
      var on = (t === b.key);
      if (btn) {
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      }
      if (pane) pane.hidden = !on;
    });
    if (t === 'search' && dom.search) {
      setTimeout(function () { dom.search.focus(); }, 40);
    }
  }

  /* ── 칩 ───────────────────────────────────────────── */
  function renderDateChips() {
    var box = dom.dateChips;
    box.innerHTML = '';
    var total = 0;
    state.index.dates.forEach(function (d) { total += Number(d.count || 0); });
    if (dom.dateMeta) {
      dom.dateMeta.textContent = '총 ' + state.index.dates.length + '일 · ' + total + '편';
    }
    if (dom.tabLabelDate) {
      dom.tabLabelDate.textContent = state.activeDate === 'all'
        ? '전체'
        : fmtDateLabel(state.activeDate);
    }
    var all = document.createElement('button');
    all.type = 'button';
    all.className = 'chip' + (state.activeDate === 'all' ? ' active' : '');
    all.innerHTML = '<span class="chip-txt">전체</span><span class="n">' + total + '</span>';
    all.addEventListener('click', function () {
      state.activeTab = 'toc';
      syncTabs();
      setDate('all');
    });
    box.appendChild(all);

    state.index.dates.forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.activeDate === d.date ? ' active' : '');
      b.innerHTML = '<span class="chip-txt">' + esc(fmtDateLabel(d.date)) + '</span><span class="n">' + Number(d.count || 0) + '</span>';
      b.addEventListener('click', function () {
        state.activeTab = 'toc';
        syncTabs();
        setDate(d.date);
      });
      box.appendChild(b);
    });
  }

  function renderFilterChips(all) {
    var cats = {};
    var catStyle = {};
    var chans = {};
    all.forEach(function (it) {
      var lbl = (it.s.categoryLabel || it.s.category || '기타').trim();
      cats[lbl] = (cats[lbl] || 0) + 1;
      if (!catStyle[lbl]) catStyle[lbl] = it.s.category || 'etc';
      var ch = it.s.channel || '기타';
      chans[ch] = (chans[ch] || 0) + 1;
    });

    // 분류 칩
    var catBox = dom.catChips;
    catBox.innerHTML = '';
    var allChip = document.createElement('button');
    allChip.type = 'button';
    allChip.className = 'chip' + (state.cat === 'all' ? ' active' : '');
    allChip.innerHTML = '<span class="chip-txt">전체 보기</span><span class="n">' + all.length + '</span>';
    allChip.addEventListener('click', function () { state.cat = 'all'; apply(); });
    catBox.appendChild(allChip);

    var keys = Object.keys(cats).sort(function (a, b) {
      return cats[b] - cats[a];
    });
    if (dom.catMeta) dom.catMeta.textContent = keys.length + '개 분류 · 영상 ' + all.length + '편';
    keys.forEach(function (lbl) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip cat-' + esc(catStyle[lbl] || 'etc') + (state.cat === lbl ? ' active' : '');
      b.innerHTML = '<span class="cat-dot"></span><span class="chip-txt">' + esc(lbl) + '</span><span class="n">' + cats[lbl] + '</span>';
      b.addEventListener('click', function () { state.cat = lbl; apply(); });
      catBox.appendChild(b);
    });

    // 채널 칩
    var isWatched = function (name) {
      return Boolean(name && state.avatars && state.avatars[name] && state.avatars[name].watched);
    };
    var watchedCatalog = Object.keys(state.avatars || {}).filter(function (k) {
      return state.avatars[k] && state.avatars[k].watched;
    });
    var allChannelSet = Object.create(null);
    Object.keys(chans).forEach(function (n) { allChannelSet[n] = true; });
    watchedCatalog.forEach(function (n) {
      if (chans[n] === undefined) chans[n] = 0;
      allChannelSet[n] = true;
    });

    var allNames = Object.keys(allChannelSet);
    var watchedCount = allNames.filter(isWatched).length;
    var singleCount = allNames.filter(function (n) { return !isWatched(n) && (chans[n] || 0) > 0; }).length;

    if (dom.channelScopeRow) {
      dom.channelScopeRow.innerHTML = '';
      [
        { key: 'all', label: '전체', count: allNames.filter(function (n) { return (chans[n] || 0) > 0 || isWatched(n); }).length },
        { key: 'watched', label: '감시 중', count: watchedCount, dot: true },
        { key: 'single', label: '단발 요약', count: singleCount }
      ].forEach(function (opt) {
        var sb = document.createElement('button');
        sb.type = 'button';
        sb.className = 'ch-scope-btn' + (state.channelScope === opt.key ? ' active' : '');
        if (opt.dot) {
          var d = document.createElement('span');
          d.className = 'watch-dot';
          sb.appendChild(d);
        }
        var lt = document.createElement('span');
        lt.textContent = opt.label + ' ' + opt.count;
        sb.appendChild(lt);
        sb.addEventListener('click', function () {
          state.channelScope = opt.key;
          if (state.channel !== 'all') {
            if (opt.key === 'watched' && !isWatched(state.channel)) state.channel = 'all';
            if (opt.key === 'single' && isWatched(state.channel)) state.channel = 'all';
          }
          apply();
        });
        dom.channelScopeRow.appendChild(sb);
      });
    }

    var chBox = dom.channelChips;
    chBox.innerHTML = '';
    var names = allNames.filter(function (n) {
      if (state.channelScope === 'watched') return isWatched(n);
      if (state.channelScope === 'single') return !isWatched(n) && (chans[n] || 0) > 0;
      return (chans[n] || 0) > 0;
    }).sort(function (a, b) {
      if ((chans[b] || 0) !== (chans[a] || 0)) return (chans[b] || 0) - (chans[a] || 0);
      return a.localeCompare(b, 'ko');
    });
    if (dom.channelMeta) {
      var scopeLabel = state.channelScope === 'watched' ? '감시 중 ' + names.length + '개 채널'
        : state.channelScope === 'single' ? '단발 요약 ' + names.length + '개 채널'
        : names.length + '개 채널 · 영상 ' + all.length + '편';
      dom.channelMeta.textContent = scopeLabel;
    }
    var b0 = document.createElement('button');
    b0.type = 'button';
    b0.className = 'chip' + (state.channel === 'all' ? ' active' : '');
    b0.innerHTML = '<span class="chip-txt">전체 보기</span><span class="n">' + all.length + '</span>';
    b0.addEventListener('click', function () { state.channel = 'all'; apply(); });
    chBox.appendChild(b0);

    names.forEach(function (n) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip channel' + (state.channel === n ? ' active' : '');
      b.appendChild(makeAvatarEl(n, true));
      if (isWatched(n)) {
        var wd = document.createElement('span');
        wd.className = 'watch-dot';
        wd.title = '자동 감시 중';
        b.appendChild(wd);
      }
      var txt = document.createElement('span');
      txt.className = 'chip-txt';
      txt.textContent = n;
      b.appendChild(txt);
      var cnt = document.createElement('span');
      cnt.className = 'n';
      cnt.textContent = chans[n] || 0;
      b.appendChild(cnt);
      b.addEventListener('click', function () { state.channel = n; apply(); });
      chBox.appendChild(b);
    });

    // 탭 배지 업데이트 (5개 탭 모두 숫자로 통일)
    if (dom.tabBadgeCat) {
      dom.tabBadgeCat.textContent = state.cat !== 'all' ? state.cat : keys.length;
      dom.tabBadgeCat.hidden = false;
    }
    if (dom.tabBadgeChannel) {
      dom.tabBadgeChannel.textContent = state.channel !== 'all' ? state.channel : names.length;
      dom.tabBadgeChannel.hidden = false;
    }

    if (dom.searchClear) dom.searchClear.hidden = !state.q;
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
  function buildCard(it) {
    var s = it.s;
    var id = s.videoId || s.id || (it.date + '-' + s.title);
    var card = document.createElement('article');
    card.className = 'card' + (isRead(id) ? ' is-read' : '');
    card.id = 'v-' + String(id).replace(/[^A-Za-z0-9_-]/g, '');
    card.dataset.vid = id;

    var url = s.url || ('https://www.youtube.com/watch?v=' + id);
    var rawTime = s.publishedAt || s.addedAt;
    var pub = fmtPublished(rawTime);
    var rel = fmtRelative(rawTime);

    var header = document.createElement('div');
    header.className = 'card-header';

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
      var nextThumb = function () {
        ci++;
        if (ci < chain.length) { img.src = chain[ci]; return; }
        card.classList.add('no-thumb');
        if (thumbLink.parentNode) thumbLink.parentNode.removeChild(thumbLink);
      };
      img.addEventListener('error', nextThumb);
      img.addEventListener('load', function () {
        if (img.naturalWidth && img.naturalWidth <= 120) nextThumb();
      });
      img.src = chain[0];
      thumbLink.appendChild(img);
      header.appendChild(thumbLink);
    }

    var chTitle = s.channel || '채널';
    var chHref = getChannelUrl(chTitle);

    var info = document.createElement('div');
    info.className = 'yt-info';

    var headRow = document.createElement('div');
    headRow.className = 'yt-head-row';

    var avLink = document.createElement('a');
    avLink.className = 'ch-av-link';
    avLink.href = chHref;
    avLink.target = '_blank';
    avLink.rel = 'noopener';
    avLink.title = chTitle + ' 채널로 이동';
    avLink.appendChild(makeAvatarEl(chTitle, false));
    headRow.appendChild(avLink);

    var main = document.createElement('div');
    main.className = 'card-main';

    var topMeta = document.createElement('div');
    topMeta.className = 'meta-row';
    var chName = document.createElement('a');
    chName.className = 'channel-name ch-link';
    chName.href = chHref;
    chName.target = '_blank';
    chName.rel = 'noopener';
    chName.textContent = chTitle;
    topMeta.appendChild(chName);

    if (s.categoryLabel) {
      var tag = document.createElement('span');
      tag.className = 'cat-tag cat-' + (s.category || 'etc');
      tag.textContent = s.categoryLabel;
      topMeta.appendChild(tag);
    }
    main.appendChild(topMeta);

    var h = document.createElement('h2');
    h.className = 'video-title';
    var q = state.q.trim();
    var titleLink = document.createElement('a');
    titleLink.href = url;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener';
    titleLink.innerHTML = q ? highlightHtml(esc(s.title || '(제목 없음)'), q) : esc(s.title || '(제목 없음)');
    h.appendChild(titleLink);
    main.appendChild(h);

    headRow.appendChild(main);
    info.appendChild(headRow);

    if (pub || rel) {
      var line = document.createElement('div');
      line.className = 'meta-line yt-time-row';
      if (rel) {
        var sr = document.createElement('span');
        sr.className = 'mi mi-rel';
        sr.textContent = rel;
        line.appendChild(sr);
      }
      if (pub) {
        var sp = document.createElement('span');
        sp.className = 'mi mi-pub';
        sp.textContent = pub;
        line.appendChild(sp);
      }
      info.appendChild(line);
    }

    header.appendChild(info);
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
        st.innerHTML = rich(b.text || '', q);
        inner.appendChild(st);
      } else if (b.type === 'ul') {
        var ulEl = document.createElement('ul');
        ulEl.className = 'bullets';
        (b.items || []).forEach(function (it2) {
          var li = document.createElement('li');
          li.innerHTML = rich(it2, q);
          ulEl.appendChild(li);
        });
        inner.appendChild(ulEl);
      } else if (b.type === 'ol') {
        var olEl = document.createElement('ol');
        olEl.className = 'bullets';
        (b.items || []).forEach(function (it2) {
          var li = document.createElement('li');
          li.innerHTML = rich(it2, q);
          olEl.appendChild(li);
        });
        inner.appendChild(olEl);
      } else if (b.type === 'callout') {
        var co = document.createElement('div');
        co.className = 'callout';
        var qm = document.createElement('span');
        qm.className = 'callout-q';
        qm.setAttribute('aria-hidden', 'true');
        qm.textContent = '“';
        co.appendChild(qm);
        var ctxt = document.createElement('div');
        ctxt.className = 'callout-txt';
        ctxt.innerHTML = rich(b.text || '', q);
        co.appendChild(ctxt);
        inner.appendChild(co);
      } else {
        splitParagraph(b.text || '').forEach(function (chunk) {
          var p = document.createElement('p');
          p.innerHTML = rich(chunk, q);
          inner.appendChild(p);
        });
      }
    });
    body.appendChild(inner);
    card.appendChild(body);

    var actions = document.createElement('div');
    actions.className = 'card-actions';

    var readBtn = document.createElement('button');
    readBtn.type = 'button';
    readBtn.className = 'act-btn' + (isRead(id) ? ' is-read' : '');
    readBtn.innerHTML = '<svg class="act-svg" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="M7.4 10.2 9.2 12l3.6-3.8"/></svg>' +
      '<span class="read-lbl">읽음</span>';
    readBtn.setAttribute('aria-pressed', isRead(id) ? 'true' : 'false');
    readBtn.addEventListener('click', function () {
      var on = toggleRead(id);
      readBtn.classList.toggle('is-read', on);
      card.classList.toggle('is-read', on);
      readBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (state.readOnly && !on) {
        if (card.parentNode) card.parentNode.removeChild(card);
        updateRead();
        if (!dom.feed.querySelector('.card')) apply();
      } else {
        updateRead();
      }
    });
    actions.appendChild(readBtn);

    var likeBtn = document.createElement('button');
    likeBtn.type = 'button';
    likeBtn.className = 'act-btn' + (isLiked(id) ? ' liked' : '');
    likeBtn.innerHTML = '<svg class="act-svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16.5s-6-3.7-6-8.3A3.5 3.5 0 0 1 10 5.7a3.5 3.5 0 0 1 6 2.5c0 4.6-6 8.3-6 8.3Z"/></svg>' +
      '<span>좋아요</span>';
    likeBtn.setAttribute('aria-pressed', isLiked(id) ? 'true' : 'false');
    likeBtn.addEventListener('click', function () {
      var on = toggleLike(id);
      likeBtn.classList.toggle('liked', on);
      likeBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (state.favOnly && !on) {
        apply();
      } else {
        updateFav();
      }
    });
    actions.appendChild(likeBtn);

    var shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className = 'act-btn';
    shareBtn.innerHTML = '<svg class="act-svg" viewBox="0 0 20 20" aria-hidden="true"><circle cx="14.5" cy="4.5" r="2"/><circle cx="5.5" cy="10" r="2"/><circle cx="14.5" cy="15.5" r="2"/><path d="M7.3 9l5.4-3.3M7.3 11l5.4 3.3"/></svg>' +
      '<span class="share-lbl">공유</span>';
    shareBtn.addEventListener('click', function () {
      var dirUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '/');
      var shareUrl = dirUrl + 's/' + encodeURIComponent(id) + '.html';
      var shareMsg = '📺 [' + chTitle + '] ' + (s.title || '') + '\n\n' + shareUrl;
      if (navigator.share) {
        navigator.share({
          text: shareMsg
        }).catch(function () {});
        return;
      }
      var done = function () {
        var lbl = shareBtn.querySelector('.share-lbl');
        shareBtn.classList.add('copied');
        if (lbl) lbl.textContent = '복사됨';
        setTimeout(function () {
          shareBtn.classList.remove('copied');
          if (lbl) lbl.textContent = '공유';
        }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareMsg).then(done).catch(function () {
          try {
            var ta = document.createElement('textarea');
            ta.value = shareMsg;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          } catch (e) {}
          done();
        });
      } else {
        try {
          var ta2 = document.createElement('textarea');
          ta2.value = shareMsg;
          ta2.style.position = 'fixed';
          ta2.style.opacity = '0';
          document.body.appendChild(ta2);
          ta2.select();
          document.execCommand('copy');
          document.body.removeChild(ta2);
        } catch (e) {}
        done();
      }
    });
    actions.appendChild(shareBtn);

    card.appendChild(actions);
    return card;
  }

  /* ── 렌더 ──────────────────────────────────────────── */
  function apply() {
    var q = state.q.trim().toLowerCase();
    var isGlobal = state.favOnly || state.readOnly || q !== '';
    var all = scopeOf(isGlobal ? 'all' : state.activeDate);
    renderFilterChips(all);

    var filtered = all.filter(function (it) {
      var s = it.s;
      var id = s.videoId || s.id || (it.date + '-' + s.title);
      if (state.favOnly && !isLiked(id)) return false;
      if (state.readOnly) {
        if (!isRead(id)) return false;
      } else if (!state.favOnly && !q && state.cat === 'all' && state.channel === 'all') {
        if (isRead(id)) return false;
      }
      var lbl = (s.categoryLabel || s.category || '기타').trim();
      if (state.cat !== 'all' && lbl !== state.cat) return false;
      if (state.channel !== 'all' && (s.channel || '기타') !== state.channel) return false;
      if (q) {
        var hay = ((s.title || '') + ' ' + (s.channel || '') + ' ' +
          (s.categoryLabel || '') + ' ' + (s.plain || summaryText(s))).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });

    var sorted = sortItems(filtered);
    var feed = dom.feed;
    if (state.feedObserver) {
      state.feedObserver.disconnect();
      state.feedObserver = null;
    }
    feed.classList.toggle('is-read-view', state.readOnly || state.favOnly || state.cat !== 'all' || state.channel !== 'all');
    feed.innerHTML = '';
    if (!sorted.length) {
      var none = document.createElement('div');
      none.className = 'state';
      none.textContent = all.length
        ? '조건에 맞는 요약이 없어요. 필터를 바꿔 보세요.'
        : '이 날짜에는 아직 요약이 없어요.';
      feed.appendChild(none);
      updateToc(sorted);
      updateRead();
      updateFav();
      updateSearchResults(sorted, all.length);
      updateSubtitle(all.length, sorted.length);
      return;
    }

    var cursor = 0;
    var lastDate = null;
    var showDividers = (state.activeDate === 'all' || isGlobal) && (state.sort === 'newest' || state.sort === 'oldest');
    var moreWrap = null;

    function appendChunk(count) {
      if (moreWrap && moreWrap.parentNode) moreWrap.parentNode.removeChild(moreWrap);
      var end = Math.min(cursor + count, sorted.length);
      var frag = document.createDocumentFragment();
      for (; cursor < end; cursor++) {
        var it = sorted[cursor];
        if (showDividers && it.date !== lastDate) {
          var div = document.createElement('div');
          div.className = 'date-divider';
          div.textContent = it.dateLabel || fmtDateLabel(it.date);
          frag.appendChild(div);
          lastDate = it.date;
        }
        frag.appendChild(buildCard(it));
      }
      feed.appendChild(frag);
      if (cursor < sorted.length) {
        if (!moreWrap) {
          moreWrap = document.createElement('div');
          moreWrap.className = 'feed-more';
          var moreBtn = document.createElement('button');
          moreBtn.type = 'button';
          moreBtn.className = 'btn';
          moreBtn.addEventListener('click', function () { appendChunk(PAGE_SIZE); });
          moreWrap.appendChild(moreBtn);
        }
        moreWrap.firstChild.textContent = '더 보기 (남은 ' + (sorted.length - cursor) + '편)';
        feed.appendChild(moreWrap);
      } else if (state.feedObserver) {
        state.feedObserver.disconnect();
        state.feedObserver = null;
      }
    }

    state.ensureAnchor = function (anchor) {
      if (document.getElementById(anchor)) return;
      for (var i = cursor; i < sorted.length; i++) {
        var s = sorted[i].s;
        var id = s.videoId || s.id;
        if ('v-' + String(id).replace(/[^A-Za-z0-9_-]/g, '') === anchor) {
          appendChunk(i - cursor + 1);
          break;
        }
      }
    };

    appendChunk(PAGE_SIZE);
    if (cursor < sorted.length && 'IntersectionObserver' in window) {
      state.feedObserver = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) {
          appendChunk(PAGE_SIZE);
        }
      }, { rootMargin: '400px 0px' });
      if (moreWrap) state.feedObserver.observe(moreWrap);
    }

    updateToc(sorted);
    updateRead();
    updateFav();
    updateSearchResults(sorted, all.length);
    updateSubtitle(all.length, sorted.length);
  }

  function updateSearchResults(sortedItems, totalCount) {
    var q = state.q.trim();
    if (dom.tabBadgeSearch) {
      dom.tabBadgeSearch.textContent = q ? (sortedItems ? sortedItems.length : 0) : 0;
      dom.tabBadgeSearch.hidden = false;
    }
    if (dom.searchMeta) {
      dom.searchMeta.textContent = q
        ? ('전체 ' + (totalCount || 0) + '편 중 ' + (sortedItems ? sortedItems.length : 0) + '건 찾음')
        : '검색어를 입력하면 전체 요약에서 찾아 바로 보여 드려요.';
    }
    var list = dom.searchResultList;
    if (!list) return;
    list.innerHTML = '';
    if (!q) return;
    if (!sortedItems || !sortedItems.length) {
      var empty = document.createElement('li');
      empty.className = 'toc-empty';
      empty.textContent = '일치하는 요약이 없습니다.';
      list.appendChild(empty);
      return;
    }
    sortedItems.forEach(function (it, idx) {
      var s = it.s;
      var id = s.videoId || s.id;
      var anchor = 'v-' + String(id).replace(/[^A-Za-z0-9_-]/g, '');
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + anchor;
      a.addEventListener('click', function () {
        if (state.activeTab !== 'toc') {
          state.activeTab = 'toc';
          syncTabs();
        }
        if (state.ensureAnchor) state.ensureAnchor(anchor);
        var el = document.getElementById(anchor);
        if (el) {
          el.classList.remove('flash');
          void el.offsetWidth;
          el.classList.add('flash');
        }
      });
      var num = document.createElement('span');
      num.className = 'toc-num';
      num.textContent = idx + 1;
      a.appendChild(num);
      var ch = document.createElement('span');
      ch.className = 'toc-channel';
      ch.textContent = s.channel || '';
      a.appendChild(ch);
      var tt = document.createElement('span');
      tt.className = 'toc-title-txt';
      tt.innerHTML = highlightHtml(esc(s.title || ''), q);
      a.appendChild(tt);
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  function loadAllDates() {
    if (!state.index) return Promise.resolve();
    return Promise.all(state.index.dates.map(function (d) {
      return loadDate(d.date).catch(function () { return null; });
    }));
  }

  function loadAllDatesIf(map) {
    if (!state.index || !map || !Object.keys(map).length) return Promise.resolve();
    return loadAllDates();
  }

  function updateRead() {
    var allLoaded = scopeOf('all');
    var readItems = allLoaded.filter(function (it) {
      var s = it.s;
      var id = s.videoId || s.id || (it.date + '-' + s.title);
      return isRead(id);
    });
    var cnt = readItems.length || Object.keys(state.reads).length;
    if (dom.tabBadgeRead) {
      dom.tabBadgeRead.textContent = cnt;
      dom.tabBadgeRead.hidden = false;
    }

    var list = dom.readList;
    if (!list) return;
    list.innerHTML = '';
    if (!readItems.length) {
      var empty = document.createElement('li');
      empty.className = 'toc-empty';
      empty.textContent = cnt ? '불러오는 중…' : '아직 읽은 요약이 없어요. 본문 아래 읽음을 누르면 목록에서 치워지고 여기에 모여요.';
      list.appendChild(empty);
      return;
    }
    sortItems(readItems).forEach(function (it, idx) {
      var s = it.s;
      var id = s.videoId || s.id;
      var anchor = 'v-' + String(id).replace(/[^A-Za-z0-9_-]/g, '');
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + anchor;
      a.addEventListener('click', function (e) {
        if (state.activeTab !== 'toc') {
          state.activeTab = 'toc';
          syncTabs();
        }
        if (state.ensureAnchor) state.ensureAnchor(anchor);
        var el = document.getElementById(anchor);
        if (el) {
          el.classList.remove('flash');
          void el.offsetWidth;
          el.classList.add('flash');
        } else {
          e.preventDefault();
          state.readOnly = true;
          setDate(it.date, anchor);
        }
      });
      var num = document.createElement('span');
      num.className = 'toc-num';
      num.textContent = idx + 1;
      a.appendChild(num);
      var ch = document.createElement('span');
      ch.className = 'toc-channel';
      ch.textContent = s.channel || '';
      a.appendChild(ch);
      var tt = document.createElement('span');
      tt.className = 'toc-title-txt';
      tt.textContent = s.title || '';
      a.appendChild(tt);
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  function updateFav() {
    var allLoaded = scopeOf('all');
    var favItems = allLoaded.filter(function (it) {
      var s = it.s;
      var id = s.videoId || s.id || (it.date + '-' + s.title);
      return isLiked(id);
    });
    var cnt = favItems.length || Object.keys(state.likes).length;
    if (dom.tabBadgeFav) {
      dom.tabBadgeFav.textContent = cnt;
      dom.tabBadgeFav.hidden = cnt === 0 && !state.favOnly;
    }
    if (dom.favFilterCount) dom.favFilterCount.textContent = cnt;
    if (dom.favFilterChip) dom.favFilterChip.classList.toggle('active', state.favOnly);

    var list = dom.favList;
    if (!list) return;
    list.innerHTML = '';
    if (!favItems.length) {
      var empty = document.createElement('li');
      empty.className = 'toc-empty';
      empty.textContent = cnt ? '불러오는 중…' : '아직 좋아요한 요약이 없어요. 본문 아래 좋아요를 눌러 모아 보세요.';
      list.appendChild(empty);
      return;
    }
    sortItems(favItems).forEach(function (it, idx) {
      var s = it.s;
      var id = s.videoId || s.id;
      var anchor = 'v-' + String(id).replace(/[^A-Za-z0-9_-]/g, '');
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + anchor;
      a.addEventListener('click', function (e) {
        if (state.activeTab !== 'toc') {
          state.activeTab = 'toc';
          syncTabs();
        }
        if (state.ensureAnchor) state.ensureAnchor(anchor);
        var el = document.getElementById(anchor);
        if (el) {
          el.classList.remove('flash');
          void el.offsetWidth;
          el.classList.add('flash');
        } else {
          e.preventDefault();
          state.favOnly = false;
          setDate(it.date, anchor);
        }
      });
      var num = document.createElement('span');
      num.className = 'toc-num';
      num.textContent = idx + 1;
      a.appendChild(num);
      var ch = document.createElement('span');
      ch.className = 'toc-channel';
      ch.textContent = s.channel || '';
      a.appendChild(ch);
      var tt = document.createElement('span');
      tt.className = 'toc-title-txt';
      tt.textContent = s.title || '';
      a.appendChild(tt);
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  function updateSubtitle(scopeCount, filteredCount) {
    if (!state.index) return;
    var label;
    if (state.favOnly) {
      label = '좋아요 모아보기';
    } else if (state.readOnly) {
      label = '읽은 글 모아보기';
    } else if (state.q.trim() !== '') {
      label = '전체 검색';
    } else if (state.activeDate === 'all') {
      label = '전체 ' + state.index.dates.length + '일';
    } else {
      var meta = null;
      state.index.dates.forEach(function (d) { if (d.date === state.activeDate) meta = d; });
      label = (meta && meta.label) || fmtDateLabel(state.activeDate);
    }
    var countText = (filteredCount != null && filteredCount !== scopeCount)
      ? filteredCount + ' / ' + scopeCount + '편'
      : (scopeCount || 0) + '편';
    dom.subtitle.textContent = label + ' · ' + countText;
  }

  function updateToc(listItems) {
    var list = dom.tocList;
    list.innerHTML = '';
    dom.tabBadgeToc.textContent = listItems ? listItems.length : 0;
    if (!listItems || !listItems.length) {
      var empty = document.createElement('li');
      empty.className = 'toc-empty';
      empty.textContent = '표시할 항목이 없습니다.';
      list.appendChild(empty);
      return;
    }
    listItems.forEach(function (it, idx) {
      var s = it.s;
      var id = s.videoId || s.id;
      var anchor = 'v-' + String(id).replace(/[^A-Za-z0-9_-]/g, '');
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + anchor;
      a.addEventListener('click', function () {
        if (state.activeTab !== 'toc') {
          state.activeTab = 'toc';
          syncTabs();
        }
        if (state.ensureAnchor) state.ensureAnchor(anchor);
        var el = document.getElementById(anchor);
        if (el) {
          el.classList.remove('flash');
          void el.offsetWidth;
          el.classList.add('flash');
        }
      });
      var num = document.createElement('span');
      num.className = 'toc-num';
      num.textContent = idx + 1;
      a.appendChild(num);
      var ch = document.createElement('span');
      ch.className = 'toc-channel';
      ch.textContent = s.channel || '';
      a.appendChild(ch);
      var tt = document.createElement('span');
      tt.className = 'toc-title-txt';
      tt.textContent = s.title || '';
      a.appendChild(tt);
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
      '<br><button class="btn retry" type="button">다시 시도</button>';
    dom.feed.appendChild(box);
    dom.subtitle.textContent = '불러오기 실패';
    var rb = box.querySelector('.retry');
    if (rb) rb.addEventListener('click', function () { boot(); });
  }

  function setDate(date, scrollAnchor) {
    state.activeDate = date;
    state.cat = 'all';
    state.channel = 'all';
    state.favOnly = false;
    state.readOnly = false;
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
      if (scrollAnchor) {
        if (state.ensureAnchor) state.ensureAnchor(scrollAnchor);
        var target = document.getElementById(scrollAnchor);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          target.classList.remove('flash');
          void target.offsetWidth;
          target.classList.add('flash');
        }
      }
      loadAllDatesIf(state.likes).then(function () {
        updateFav();
      });
      loadAllDatesIf(state.reads).then(function () {
        updateRead();
      });
    }).catch(fail);
  }

  /* ── 초기화 ────────────────────────────────────────── */
  function wire() {
    dom.subtitle = document.getElementById('subtitle');
    dom.dateChips = document.getElementById('dateChips');
    dom.catChips = document.getElementById('catChips');
    dom.channelChips = document.getElementById('channelChips');
    dom.channelScopeRow = document.getElementById('channelScopeRow');
    dom.catMeta = document.getElementById('catMeta');
    dom.channelMeta = document.getElementById('channelMeta');
    dom.feed = document.getElementById('feed');
    dom.tocList = document.getElementById('tocList');
    dom.readList = document.getElementById('readList');
    dom.favList = document.getElementById('favList');
    dom.footerMeta = document.getElementById('footerMeta');
    dom.search = document.getElementById('search');
    dom.searchClear = document.getElementById('searchClear');
    dom.sortBtn = document.getElementById('sortBtn');
    dom.tabPanel = document.getElementById('tabPanel');
    dom.dateMeta = document.getElementById('dateMeta');
    dom.tabLabelDate = document.getElementById('tabLabelDate');
    dom.tabBadgeCat = document.getElementById('tabBadgeCat');
    dom.tabBadgeChannel = document.getElementById('tabBadgeChannel');
    dom.tabBadgeToc = document.getElementById('tabBadgeToc');
    dom.tabBadgeRead = document.getElementById('tabBadgeRead');
    dom.tabBadgeFav = document.getElementById('tabBadgeFav');
    dom.tabBadgeSearch = document.getElementById('tabBadgeSearch');
    dom.searchMeta = document.getElementById('searchMeta');
    dom.searchResultList = document.getElementById('searchResultList');

    ['tabBtnDate', 'tabBtnToc', 'tabBtnCat', 'tabBtnChannel', 'tabBtnRead', 'tabBtnFav', 'tabBtnSearch'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', function () {
          setTab(btn.dataset.tab);
        });
      }
    });
    syncTabs();

    var sortSvg = document.getElementById('sortSvg');
    var sortLbl = document.getElementById('sortLbl');
    function syncSortBtn() {
      var isOld = state.sort === 'oldest';
      if (sortLbl) sortLbl.textContent = isOld ? '오래된순' : '최신순';
      if (sortSvg) {
        sortSvg.innerHTML = isOld
          ? '<path d="M10 16V4M5.5 8.5 10 4l4.5 4.5"/>'
          : '<path d="M10 4v12M5.5 11.5 10 16l4.5-4.5"/>';
      }
    }
    syncSortBtn();
    if (dom.sortBtn) {
      dom.sortBtn.addEventListener('click', function () {
        state.sort = (state.sort === 'newest') ? 'oldest' : 'newest';
        try { localStorage.setItem(LS_SORT, state.sort); } catch (e) {}
        syncSortBtn();
        apply();
      });
    }

    if (dom.searchClear) {
      dom.searchClear.addEventListener('click', function () {
        state.q = '';
        dom.search.value = '';
        dom.search.focus();
        apply();
      });
    }

    var themeBtn = document.getElementById('themeBtn');
    var themeSvg = document.getElementById('themeSvg');
    var themeLbl = document.getElementById('themeLbl');
    function syncThemeBtn() {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (themeLbl) themeLbl.textContent = dark ? '라이트' : '다크';
      if (themeSvg) {
        themeSvg.innerHTML = dark
          ? '<circle cx="10" cy="10" r="3.6"/><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M15.3 4.7 14 6M6 14l-1.3 1.3"/>'
          : '<path d="M15.8 12.6A6.5 6.5 0 0 1 7.4 4.2a6.5 6.5 0 1 0 8.4 8.4Z"/>';
      }
      var ml = document.getElementById('metaThemeLight');
      var md = document.getElementById('metaThemeDark');
      var bg = dark ? '#0b0f17' : '#f4f6fa';
      if (ml) ml.setAttribute('content', bg);
      if (md) md.setAttribute('content', bg);
    }
    syncThemeBtn();
    themeBtn.addEventListener('click', function () {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      var next = dark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(LS_THEME, next); } catch (e) {}
      syncThemeBtn();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== dom.search && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        state.activeTab = 'search';
        syncTabs();
      } else if (e.key === 'Escape' && state.activeTab) {
        if (state.activeTab !== 'toc') {
          state.activeTab = 'toc';
          syncTabs();
        }
      }
    });

    dom.search.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.q = dom.search.value || '';
        if (state.q.trim() !== '') {
          loadAllDates().then(function () { apply(); });
        } else {
          apply();
        }
      }, 120);
    });

    var topBtn = document.getElementById('topBtn');
    var hub = document.getElementById('siteHeader');
    topBtn.addEventListener('click', function () {
      if (hub) hub.classList.remove('is-hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    var lastY = Math.max(0, window.scrollY || 0);
    var lastT = performance.now();
    var upDist = 0;
    var downDist = 0;
    var hubHidden = false;

    function setHubHidden(next) {
      if (!hub || hubHidden === next) return;
      hubHidden = next;
      hub.classList.toggle('is-hidden', next);
    }

    window.addEventListener('scroll', function () {
      var y = Math.max(0, window.scrollY || 0);
      topBtn.classList.toggle('show', y > 600);

      if (!hub || hub.hidden) return;
      if (dom.search && document.activeElement === dom.search) return;

      var now = performance.now();
      var dy = y - lastY;
      var dt = Math.max(1, now - lastT);
      lastY = y;
      lastT = now;

      if (y <= 60) {
        upDist = 0;
        downDist = 0;
        setHubHidden(false);
        return;
      }

      if (dy > 0) {
        upDist = 0;
        downDist += dy;
        if (!hubHidden && y > 90 && downDist >= 16) {
          downDist = 0;
          setHubHidden(true);
        }
      } else if (dy < 0) {
        downDist = 0;
        upDist += -dy;
        var speed = (-dy) / dt;
        if (hubHidden && upDist >= 260 && speed >= 2.2) {
          upDist = 0;
          setHubHidden(false);
        }
      }
    }, { passive: true });
  }

  function getQueryParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name) || '';
    } catch (e) {
      return '';
    }
  }

  function renderSingleCard(dateHint, videoId) {
    var hub = document.getElementById('siteHeader');
    if (hub) hub.hidden = true;
    dom.feed.innerHTML = '<div class="state">요약을 불러오는 중…</div>';

    function showFound(found) {
      var bar = document.createElement('div');
      bar.className = 'single-bar';
      var backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'btn';
      backBtn.innerHTML = '<svg class="btn-svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 5 7.5 10l5 5"/></svg><span class="btn-lbl">전체 요약 보기</span>';
      backBtn.addEventListener('click', function () {
        state.singleMode = null;
        if (hub) hub.hidden = false;
        try {
          var clean = window.location.href.split('#')[0].split('?')[0];
          window.history.replaceState(null, '', clean);
        } catch (e) {}
        setDate('all');
      });
      bar.appendChild(backBtn);

      var themeClone = document.createElement('button');
      themeClone.type = 'button';
      themeClone.className = 'btn';
      var syncSingleTheme = function () {
        var dark = document.documentElement.getAttribute('data-theme') === 'dark';
        themeClone.innerHTML = (dark
          ? '<svg class="btn-svg" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6"/><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M15.3 4.7 14 6M6 14l-1.3 1.3"/></svg><span class="btn-lbl">라이트</span>'
          : '<svg class="btn-svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M15.8 12.6A6.5 6.5 0 0 1 7.4 4.2a6.5 6.5 0 1 0 8.4 8.4Z"/></svg><span class="btn-lbl">다크</span>');
      };
      syncSingleTheme();
      themeClone.addEventListener('click', function () {
        var mainThemeBtn = document.getElementById('themeBtn');
        if (mainThemeBtn) mainThemeBtn.click();
        syncSingleTheme();
      });
      bar.appendChild(themeClone);

      dom.feed.innerHTML = '';
      dom.feed.appendChild(bar);
      dom.feed.appendChild(buildCard(found));
      document.title = '[' + (found.s.channel || '') + '] ' + (found.s.title || '피클 유튜브 요약');
      renderFooter();
    }

    function findInDate(d) {
      return loadDate(d).then(function (doc) {
        var list = doc.summaries || [];
        for (var i = 0; i < list.length; i++) {
          var s = list[i];
          var sid = s.videoId || s.id || '';
          if (sid === videoId) {
            return { s: s, date: d, dateLabel: doc.label || fmtDateLabel(d) };
          }
        }
        return null;
      });
    }

    var datesToCheck = [];
    if (dateHint) datesToCheck.push(dateHint);
    state.index.dates.forEach(function (d) {
      if (d.date !== dateHint) datesToCheck.push(d.date);
    });

    var chain = Promise.resolve(null);
    datesToCheck.forEach(function (d) {
      chain = chain.then(function (found) {
        if (found) return found;
        return findInDate(d).catch(function () { return null; });
      });
    });

    chain.then(function (found) {
      if (found) {
        state.activeDate = found.date;
        showFound(found);
      } else {
        if (hub) hub.hidden = false;
        dom.feed.innerHTML = '<div class="state">해당 요약을 찾을 수 없어요.</div>';
      }
    }).catch(fail);
  }

  function boot() {
    Promise.all([loadAvatars(), loadIndex()]).then(function (res) {
      var dates = res[1];
      if (!dates.length) {
        dom.subtitle.textContent = '요약 없음';
        dom.feed.innerHTML = '<div class="state">아직 등록된 요약이 없어요.</div>';
        return;
      }
      var qv = getQueryParam('v');
      var qd = getQueryParam('d');
      if (qv) {
        state.singleMode = { date: qd, videoId: qv };
        renderSingleCard(qd, qv);
        return;
      }
      setDate('all');
    }).catch(fail);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { wire(); boot(); });
  } else {
    wire();
    boot();
  }
})();
