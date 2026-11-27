/* Pickle Agents — 소통 & 협업 대시보드
   원장(JSON)만 읽어서 그립니다. 값이 없으면 그 자리를 비우고 안내 문구로 대체합니다. */
(function () {
  'use strict';

  var DATA = '../data/';
  var REPO = '0xhangang/youtube-summary';
  var COMMIT_BASE = 'https://github.com/' + REPO + '/commit/';
  var TZ = 'Asia/Seoul';

  var state = { comms: [], filter: 'all' };

  function $(id) { return document.getElementById(id); }

  function fetchJSON(path) {
    var url = path + (path.indexOf('?') === -1 ? '?' : '&') + 'v=' + Date.now();
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ── KST 시간 ────────────────────────────────────────── */
  var partsFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  });
  var WD = { Sun: '일', Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토' };

  function kst(iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) return null;
    var p = {}, wd = '';
    partsFmt.formatToParts(d).forEach(function (x) {
      if (x.type === 'weekday') wd = x.value; else p[x.type] = x.value;
    });
    return {
      date: p.year + '-' + p.month + '-' + p.day,
      ymdKo: p.year + '년 ' + p.month + '월 ' + p.day + '일',
      wd: WD[wd] || '',
      md: p.month + '-' + p.day,
      hm: p.hour + ':' + p.minute
    };
  }
  function todayKST() { return kst().date; }

  function shiftDate(ymd, delta) {
    var a = ymd.split('-').map(Number);
    var d = new Date(Date.UTC(a[0], a[1] - 1, a[2] + delta));
    var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    var dd = String(d.getUTCDate()).padStart(2, '0');
    return d.getUTCFullYear() + '-' + mm + '-' + dd;
  }

  /* ── 인라인 코드(`…`) 렌더 ───────────────────────────── */
  function richText(el, text) {
    String(text || '').split('`').forEach(function (chunk, i) {
      if (!chunk) return;
      if (i % 2 === 1) {
        var c = document.createElement('code');
        c.textContent = chunk;
        el.appendChild(c);
      } else {
        el.appendChild(document.createTextNode(chunk));
      }
    });
  }

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  /* ── 헤더 + 관계도 ───────────────────────────────────── */
  function failoverMode(f) {
    if (!f || !f.mode) return 'unknown';
    var expired = f.expiresAt ? new Date(f.expiresAt).getTime() < Date.now() : false;
    return (f.mode === 'failover' && !expired) ? 'failover' : 'normal';
  }

  function paintBadge(mode) {
    var badge = $('liveBadge');
    badge.setAttribute('data-mode', mode);
    setText('liveText', mode === 'unknown' ? '확인 불가' : mode);
    badge.setAttribute('title', mode === 'failover'
      ? '백업 모드 — 한쪽 한도 소진으로 상대 담당까지 처리 중'
      : mode === 'normal' ? '정상 — 두 레이더가 각자 담당만 실행' : '원장 상태를 읽지 못했습니다');
  }

  function nodeState(el, status, isBackup) {
    el.textContent = '';
    function pill(s, label) {
      var p = document.createElement('span');
      p.className = 'pill-state';
      p.setAttribute('data-s', s);
      p.textContent = label;
      el.appendChild(p);
    }
    if (status === 'active') pill('active', 'active');
    else if (status === 'exhausted') pill('exhausted', '한도 소진');
    else pill('unknown', '상태 미확인');
    if (isBackup) pill('backup', '백업 가동');
  }

  function loadLive() {
    return Promise.all([
      fetchJSON(DATA + 'failover.json').catch(function () { return null; }),
      fetchJSON(DATA + 'radar_assign.json').catch(function () { return null; })
    ]).then(function (res) {
      var f = res[0], a = res[1];
      var mode = failoverMode(f);
      paintBadge(mode);

      /* 담당 채널 수 · 배정 비율 */
      var sat = a && Array.isArray(a.satoshi) ? a.satoshi.length : null;
      var vit = a && Array.isArray(a.vitalik) ? a.vitalik.length : null;
      var total = (sat || 0) + (vit || 0);

      setText('numSatoshi', sat === null ? '–' : String(sat));
      setText('numVitalik', vit === null ? '–' : String(vit));
      if (total > 0) {
        setText('ratioSatoshi', Math.round(sat / total * 100) + '%');
        setText('ratioVitalik', Math.round(vit / total * 100) + '%');
        $('barSatoshi').style.width = (sat / total * 100).toFixed(1) + '%';
        $('barVitalik').style.width = (vit / total * 100).toFixed(1) + '%';
      } else {
        setText('ratioSatoshi', '');
        setText('ratioVitalik', '');
      }

      /* 실행 시각 */
      var sch = a && a.schedule ? a.schedule : null;
      if (sch && sch.satoshi && sch.vitalik) {
        setText('statSchedule', sch.satoshi + ' / ' + sch.vitalik);
        setText('statScheduleSub', '사토시 · 비탈릭');
        var s1 = document.querySelector('#nodeSatoshi .node-sub');
        var s2 = document.querySelector('#nodeVitalik .node-sub');
        if (s1) s1.textContent = '매시 ' + sch.satoshi;
        if (s2) s2.textContent = '매시 ' + sch.vitalik;
      } else {
        setText('statSchedule', '–');
      }

      /* 노드 상태 */
      var backup = mode === 'failover' && f ? f.backup_owner : null;
      nodeState($('stateSatoshi'), f ? f.satoshi_status : null, backup === 'satoshi');
      nodeState($('stateVitalik'), f ? f.vitalik_status : null, backup === 'vitalik');

      /* 안내 문구 */
      var note;
      if (mode === 'failover' && f) {
        var owner = f.backup_owner === 'satoshi' ? '사토시' : f.backup_owner === 'vitalik' ? '비탈릭' : null;
        var until = f.expiresAt ? kst(f.expiresAt) : null;
        note = owner
          ? '백업 모드 ON — ' + owner + '가 상대 담당까지 처리 중' + (until ? ' (자동 복구 ' + until.hm + ' · 04:00 리셋)' : '') + '.'
          : '백업 모드 — 양쪽 한도 소진으로 대행할 계정이 없습니다. 04:00 리셋을 기다립니다.';
      } else if (mode === 'normal') {
        note = '평상시 — 각자 담당만 실행합니다. 사토시 :00 · 비탈릭 :05 시각을 엇갈려 푸시 충돌을 막습니다.';
      } else {
        note = '원장 상태(failover.json)를 읽지 못했습니다. 회차는 각자 담당만 실행하는 것이 기본값입니다.';
      }
      setText('topoNote', note);

      var t = f && f.updatedAt ? kst(f.updatedAt) : null;
      setText('topoHint', t ? '원장 ' + t.md + ' ' + t.hm : '원장 기준');
    });
  }

  /* ── 감시 채널 수 ────────────────────────────────────── */
  function loadChannels() {
    return fetchJSON(DATA + 'channels.json').then(function (ch) {
      var keys = Object.keys(ch || {});
      var watched = keys.filter(function (k) { return ch[k] && ch[k].watched === true; }).length;
      setText('statChannels', String(watched));
      setText('statChannelsSub', '전체 ' + keys.length + '개 채널');
    }).catch(function () {
      setText('statChannels', '–');
      setText('statChannelsSub', '불러오지 못함');
    });
  }

  /* ── 오늘(또는 최근) 요약 수 ─────────────────────────── */
  function loadToday() {
    var today = todayKST();
    var chain = Promise.reject();
    for (var i = 0; i < 7; i++) {
      (function (offset) {
        var day = shiftDate(today, -offset);
        chain = chain.catch(function () {
          return fetchJSON(DATA + day + '.json').then(function (j) { return { day: day, data: j }; });
        });
      })(i);
    }
    return chain.then(function (hit) {
      var n = hit.data && Array.isArray(hit.data.summaries) ? hit.data.summaries.length : 0;
      var isToday = hit.day === today;
      setText('statTodayKey', isToday ? '오늘 요약' : '최근 요약');
      setText('statToday', String(n));
      setText('statTodaySub', isToday ? 'KST ' + hit.day.slice(5) : 'KST ' + hit.day.slice(5) + ' 기준');
      var up = hit.data && hit.data.updatedAt ? kst(hit.data.updatedAt) : null;
      setText('liveHint', up ? '요약 원장 갱신 ' + up.md + ' ' + up.hm : '');
    }).catch(function () {
      setText('statToday', '–');
      setText('statTodaySub', '요약 파일 없음');
    });
  }

  /* ── 최근 커밋 ───────────────────────────────────────── */
  function loadCommits() {
    var list = $('commitList');
    return fetch('https://api.github.com/repos/' + REPO + '/commits?per_page=12', {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store'
    }).then(function (r) {
      if (r.status === 403 || r.status === 429) {
        throw new Error('rate-limit');
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (rows) {
      if (!Array.isArray(rows) || !rows.length) throw new Error('empty');
      list.textContent = '';
      rows.forEach(function (c) {
        var t = kst(c.commit && c.commit.committer ? c.commit.committer.date : null);
        var msg = (c.commit && c.commit.message ? c.commit.message.split('\n')[0] : '(메시지 없음)');
        var sha = (c.sha || '').slice(0, 7);

        var a = document.createElement('a');
        a.className = 'tl-row';
        a.href = c.html_url || (COMMIT_BASE + c.sha);
        a.target = '_blank';
        a.rel = 'noopener';

        var time = document.createElement('span');
        time.className = 'tl-time';
        time.textContent = t ? t.hm : '--:--';

        var body = document.createElement('span');
        body.className = 'tl-body';
        var m = document.createElement('span');
        m.className = 'tl-msg';
        m.textContent = msg;
        var sub = document.createElement('span');
        sub.className = 'tl-sub';
        sub.textContent = (t ? t.md + ' · ' : '') + sha;
        body.appendChild(m);
        body.appendChild(sub);

        a.appendChild(time);
        a.appendChild(body);
        list.appendChild(a);
      });
    }).catch(function (err) {
      list.textContent = '';
      var p = document.createElement('div');
      p.className = 'tl-state';
      p.textContent = err && err.message === 'rate-limit'
        ? 'GitHub API 호출 한도를 넘었습니다(시간당 60회). 잠시 뒤 새로고침하면 다시 불러옵니다.'
        : '커밋 목록을 불러오지 못했습니다. GitHub 저장소에서 직접 확인할 수 있습니다.';
      list.appendChild(p);
    });
  }

  /* ── 소통 타임라인 ───────────────────────────────────── */
  function matches(entry, filter) {
    if (filter === 'all') return true;
    if (filter === 'system') return entry.type === '규칙·시스템' || entry.type === 'Failover';
    return entry.pair === filter;
  }

  function renderComms() {
    var feed = $('commList');
    feed.textContent = '';

    var rows = state.comms
      .filter(function (e) { return matches(e, state.filter); })
      .sort(function (a, b) { return new Date(b.time) - new Date(a.time); });

    setText('commsHint', rows.length + '건');

    if (!rows.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '해당하는 소통 기록이 없습니다.';
      feed.appendChild(empty);
      return;
    }

    var lastDay = '';
    rows.forEach(function (e) {
      var t = kst(e.time);
      if (!t) return;

      if (t.date !== lastDay) {
        lastDay = t.date;
        var day = document.createElement('div');
        day.className = 'day';
        day.textContent = t.ymdKo + (t.wd ? ' (' + t.wd + ')' : '');
        feed.appendChild(day);
      }

      var card = document.createElement('article');
      card.className = 'cm';

      var head = document.createElement('div');
      head.className = 'cm-head';

      var time = document.createElement('time');
      time.className = 'cm-time';
      time.dateTime = e.time;
      time.textContent = t.md + ' ' + t.hm;
      head.appendChild(time);

      var flow = document.createElement('span');
      flow.className = 'cm-flow';
      flow.setAttribute('data-from', e.from === '집사' ? 'main' : (e.pair || ''));
      var b = document.createElement('b');
      b.textContent = e.from;
      flow.appendChild(b);
      flow.appendChild(document.createTextNode(' → ' + e.to));
      head.appendChild(flow);

      if (e.type) {
        var tag = document.createElement('span');
        tag.className = 'cm-type';
        tag.setAttribute('data-type', e.type);
        tag.textContent = e.type;
        head.appendChild(tag);
      }

      card.appendChild(head);

      var h = document.createElement('h3');
      h.className = 'cm-title';
      richText(h, e.title);
      card.appendChild(h);

      if (e.summary) {
        var p = document.createElement('p');
        p.className = 'cm-body';
        richText(p, e.summary);
        card.appendChild(p);
      }

      if (Array.isArray(e.commits) && e.commits.length) {
        var box = document.createElement('div');
        box.className = 'cm-commits';
        e.commits.forEach(function (sha) {
          var a = document.createElement('a');
          a.className = 'hash';
          a.href = COMMIT_BASE + sha;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = sha;
          box.appendChild(a);
        });
        card.appendChild(box);
      }

      feed.appendChild(card);
    });
  }

  function loadComms() {
    return fetchJSON(DATA + 'agent_comms.json').then(function (j) {
      state.comms = Array.isArray(j && j.entries) ? j.entries : [];
      var up = j && j.updatedAt ? kst(j.updatedAt) : null;
      setText('footerMeta', '소통 기록 ' + state.comms.length + '건'
        + (up ? ' · 갱신 ' + up.md + ' ' + up.hm : ''));
      renderComms();
    }).catch(function () {
      state.comms = [];
      $('commList').textContent = '';
      var p = document.createElement('div');
      p.className = 'tl-state';
      p.textContent = '소통 원장(data/agent_comms.json)을 불러오지 못했습니다.';
      $('commList').appendChild(p);
      setText('commsHint', '–');
    });
  }

  /* ── 필터 ────────────────────────────────────────────── */
  function bindTabs() {
    var tabs = $('filterTabs');
    tabs.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.tab');
      if (!btn) return;
      state.filter = btn.getAttribute('data-filter') || 'all';
      Array.prototype.forEach.call(tabs.querySelectorAll('.tab'), function (t) {
        var on = t === btn;
        t.classList.toggle('is-on', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      renderComms();
    });
  }

  /* ── 새로고침 ────────────────────────────────────────── */
  function stamp() {
    var t = kst();
    setText('hdrMeta', '확인 ' + t.hm + ' KST');
  }

  function loadAll(manual) {
    var btn = $('refreshBtn');
    if (manual) btn.classList.add('is-busy');
    stamp();
    return Promise.all([
      loadLive(),
      loadChannels(),
      loadToday(),
      loadCommits(),
      loadComms()
    ]).catch(function () { /* 각 로더가 자체 처리 */ }).then(function () {
      btn.classList.remove('is-busy');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindTabs();
    $('refreshBtn').addEventListener('click', function () { loadAll(true); });
    loadAll(false);
  });
})();
