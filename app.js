(function () {
  'use strict';

  var DATA = window.QUIZ_DATA;
  if (!DATA) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;font-size:14px">题库数据加载失败，请确认 data.js 与 index.html 在同一目录。</div>';
    return;
  }

  /* ---------------- 差分包（opt/） ---------------- */
  /* 差分包由 opt/manifest.js 在 data.js 之后、本文件之前按顺序加载 */
  function mergeDiffData(base, packs) {
    var chapters = (base.chapters || []).map(function (c) {
      return { id: c.id, name: c.name, exam: c.exam, count: c.count || 0 };
    });
    var questions = (base.questions || []).slice();
    var seenQ = new Set();
    var chapterMap = new Map();
    questions.forEach(function (q) { seenQ.add(q.i); });
    chapters.forEach(function (c) { chapterMap.set(c.id, c); });

    packs.forEach(function (pack) {
      if (!pack) return;
      (pack.questions || []).forEach(function (q) {
        if (!q || seenQ.has(q.i)) return;
        seenQ.add(q.i);
        questions.push(q);
      });
      (pack.chapters || []).forEach(function (c) {
        var exist = chapterMap.get(c.id);
        if (exist) {
          exist.count = (exist.count || 0) + (c.count || 0);
        } else {
          var added = { id: c.id, name: c.name, exam: c.exam, count: c.count || 0 };
          chapters.push(added);
          chapterMap.set(c.id, added);
        }
      });
    });

    chapters.sort(function (a, b) {
      return (a.exam - b.exam) || (a.id - b.id);
    });
    return { chapters: chapters, questions: questions };
  }

  DATA = mergeDiffData(DATA, window.QUIZ_DIFF_PACKS || []);

  /* 差分包图片路径索引，按文件名映射到 opt/<包>/img/ */
  var DIFF_IMAGE = {};
  (window.QUIZ_DIFF_MANIFEST || []).forEach(function (pack) {
    var dir = String(pack.dir || '');
    if (dir.indexOf('opt/') !== 0) dir = 'opt/' + dir;
    (pack.images || []).forEach(function (name) {
      if (!name) return;
      DIFF_IMAGE[String(name).toLowerCase()] = dir + '/img/' + encodeURIComponent(name);
    });
  });

  function imgSrc(name) {
    return DIFF_IMAGE[String(name).toLowerCase()] || ('img/' + encodeURIComponent(name));
  }

  var QUESTIONS = DATA.questions;
  var CHAPTERS = DATA.chapters;
  var QMAP = new Map();
  QUESTIONS.forEach(function (q) { QMAP.set(q.i, q); });

  var BY_EXAM = { 1: [], 4: [] };
  var LIGHT = [];
  QUESTIONS.forEach(function (q) {
    if (q.x === 1 || q.x === 4) BY_EXAM[q.x].push(q);
    if (q.c === 11) LIGHT.push(q);
  });

  var CHAPTER_MAP = new Map();
  CHAPTERS.forEach(function (c) { CHAPTER_MAP.set(c.id, c); });

  var LS_KEY = 'dx_quiz_state_v1';

  function emptyExamState() {
    return { right: [], wrong: [], collect: [], ans: {}, seq: 0 };
  }

  function loadStore() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { s = null; }
    if (!s || !s[1] || !s[4]) s = { 1: emptyExamState(), 4: emptyExamState() };
    if (!s[1].ans) s[1].ans = {};
    if (!s[4].ans) s[4].ans = {};
    return s;
  }

  var store = loadStore();

  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) { /* 空间不足时忽略 */ }
  }

  var SETTINGS_KEY = 'dx_quiz_settings_v1';

  function loadSettings() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') s = {};
    if (s.confirm !== 'tap' && s.confirm !== 'button') s.confirm = 'button';
    if (s.theme !== 'day' && s.theme !== 'night') s.theme = 'day';
    if (s.autoNext !== 'right') s.autoNext = 'off';
    if (typeof s.deleteConfirm !== 'boolean') s.deleteConfirm = true;
    if (s.searchLimit !== 'all' && s.searchLimit !== 'custom'
      && s.searchLimit !== 50 && s.searchLimit !== 100 && s.searchLimit !== 200) {
      s.searchLimit = 50;
    }
    var custom = Math.round(Number(s.searchCustom));
    if (!isFinite(custom) || custom < 1) custom = 50;
    s.searchCustom = Math.min(custom, 9999);
    if (typeof s.showLoadRest !== 'boolean') s.showLoadRest = false;
    return s;
  }

  var settings = loadSettings();

  function persistSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 选定内容练习历史 ---------------- */
  var HISTORY_KEY = 'dx_quiz_picker_history_v1';

  function loadHistory() {
    var list = null;
    try { list = JSON.parse(localStorage.getItem(HISTORY_KEY) || 'null'); } catch (e) { list = null; }
    if (!Array.isArray(list)) return [];
    return list.filter(function (r) {
      return r && r.id && Array.isArray(r.qids) && r.qids.length
        && (r.exam === 1 || r.exam === 4);
    });
  }

  var pickHist = loadHistory();
  var historySel = new Set();

  function persistHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(pickHist)); } catch (e) { /* 忽略 */ }
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function formatTime(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
      + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function historyById(id) {
    for (var i = 0; i < pickHist.length; i++) {
      if (pickHist[i].id === id) return pickHist[i];
    }
    return null;
  }

  function saveHistoryIdx() {
    if (!session || !session.historyId) return;
    var rec = historyById(session.historyId);
    if (!rec) return;
    rec.idx = session.idx;
    persistHistory();
  }

  var session = null;
  var autoConfirmTimer = null;
  var autoNextTimer = null;
  var exam = 1;

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 首页 ---------------- */
  function examStat(ex) {
    var st = store[ex];
    var right = new Set(st.right), wrong = new Set(st.wrong), collect = new Set(st.collect);
    var done = new Set(st.right.concat(st.wrong));
    return {
      right: right,
      wrong: wrong,
      collect: collect,
      doneCount: done.size,
      rate: done.size ? Math.round(right.size / done.size * 100) : 0
    };
  }

  function renderHome() {
    var st = examStat(exam);
    $('statDone').textContent = st.doneCount;
    $('statRate').textContent = st.rate + '%';
    $('statWrong').textContent = st.wrong.size;
    $('statCollect').textContent = st.collect.size;
    $('homeTotal').textContent = QUESTIONS.length;

    var seqIdx = Math.min(store[exam].seq || 0, BY_EXAM[exam].length - 1);
    $('seqHint').textContent = seqIdx > 0 ? ('上次练到第 ' + (seqIdx + 1) + ' 题') : '从第一题开始';
    $('wrongHint').textContent = st.wrong.size ? (st.wrong.size + ' 题待巩固') : '暂无错题';
    $('collectHint').textContent = st.collect.size ? (st.collect.size + ' 题已收藏') : '暂无收藏';
    $('chapterHint').textContent = CHAPTERS.filter(function (c) { return c.exam === exam; }).length + ' 个章节';
    $('lightModeRow').hidden = exam !== 1;
    document.querySelectorAll('.subject-tab').forEach(function (t) {
      t.classList.toggle('active', Number(t.dataset.exam) === exam);
    });
    var hCount = pickHist.filter(function (r) { return r.exam === exam; }).length;
    $('historyHint').textContent = hCount ? (hCount + ' 条记录待继续') : '暂无练习记录';
  }

  function openHistoryScreen() {
    renderHistory();
    showScreen('history');
  }

  /* ---------------- 历史记录列表 ---------------- */
  function renderHistory() {
    var list = pickHist.filter(function (r) { return r.exam === exam; });
    var ids = new Set(list.map(function (r) { return r.id; }));
    historySel.forEach(function (id) {
      if (!ids.has(id)) historySel.delete(id);
    });

    $('historyEmpty').hidden = list.length > 0;
    $('historyList').innerHTML = list.map(function (r) {
      var on = historySel.has(r.id);
      var total = r.qids.length;
      var cur = Math.min(Math.max(r.idx || 0, 0), total - 1) + 1;
      return '<div class="hist-item' + (on ? ' on' : '') + '" data-hid="' + escapeHtml(r.id) + '">'
        + '<button class="hist-check" data-hist-check="' + escapeHtml(r.id) + '" aria-label="选择记录">✓</button>'
        + '<div class="hist-main" data-hist-open="' + escapeHtml(r.id) + '">'
        + '<div class="hist-title">' + escapeHtml(r.title) + '</div>'
        + '<div class="hist-meta">' + escapeHtml(r.createdAt) + ' · 进度 ' + cur + '/' + total + '</div>'
        + '</div>'
        + '<button class="hist-rename" data-hist-rename="' + escapeHtml(r.id) + '">重命名</button>'
        + '<button class="hist-del" data-hist-del="' + escapeHtml(r.id) + '">删除</button>'
        + '</div>';
    }).join('');
    updateHistoryBar();
  }

  function updateHistoryBar() {
    $('historyBar').hidden = historySel.size === 0;
  }

  function toggleHistorySel(id) {
    if (historySel.has(id)) historySel.delete(id);
    else historySel.add(id);
    var item = document.querySelector('.hist-item[data-hid="' + id + '"]');
    if (item) item.classList.toggle('on', historySel.has(id));
    updateHistoryBar();
  }

  function openHistory(id) {
    var rec = historyById(id);
    if (!rec) return;
    var list = rec.qids.map(function (qid) { return QMAP.get(qid); }).filter(function (q) {
      return q && q.x === rec.exam;
    });
    if (!list.length) { toast('该记录中的题目已不存在'); return; }
    exam = rec.exam;
    historySel.clear();
    renderHome();
    startListPractice(list, rec.title, 'home', rec.idx, 'picked');
    session.historyId = rec.id;
  }

  function deleteSelectedHistory() {
    if (!historySel.size) return;
    var n = historySel.size;
    askDelete('删除练习记录', '确定要删除选中的 ' + n + ' 条练习记录吗？删除后无法恢复。', function () {
      pickHist = pickHist.filter(function (r) { return !historySel.has(r.id); });
      historySel.clear();
      persistHistory();
      renderHistory();
      toast('已删除 ' + n + ' 条记录');
    });
  }

  function deleteHistory(id) {
    var rec = historyById(id);
    if (!rec) return;
    askDelete('删除练习记录', '确定要删除「' + rec.title + '」这条练习记录吗？删除后无法恢复。', function () {
      pickHist = pickHist.filter(function (r) { return r.id !== id; });
      historySel.delete(id);
      persistHistory();
      renderHistory();
      toast('已删除该记录');
    });
  }

  function startRenameHistory(id) {
    var rec = historyById(id);
    if (!rec) return;
    var item = document.querySelector('.hist-item[data-hid="' + id + '"]');
    if (!item) return;
    var titleEl = item.querySelector('.hist-title');
    if (!titleEl) return;

    var input = document.createElement('input');
    input.className = 'hist-title-input';
    input.type = 'text';
    input.maxLength = 40;
    input.value = rec.title;
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    var done = false;
    function finish(save) {
      if (done) return;
      done = true;
      var v = input.value.trim();
      if (save && v) {
        rec.title = v;
        persistHistory();
      }
      renderHistory();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
    });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    input.addEventListener('blur', function () { finish(true); });
  }

  function showScreen(id) {
    ['home', 'chapters', 'picker', 'history', 'search', 'settings', 'practice'].forEach(function (s) {
      $(s).hidden = (s !== id);
    });
    window.scrollTo(0, 0);
  }

  /* ---------------- 设置 ---------------- */
  function openSettings() {
    renderSettings();
    showScreen('settings');
  }

  function renderSettings() {
    document.querySelectorAll('[data-confirm]').forEach(function (row) {
      row.classList.toggle('on', row.dataset.confirm === settings.confirm);
    });
    document.querySelectorAll('[data-theme-mode]').forEach(function (row) {
      row.classList.toggle('on', row.dataset.themeMode === settings.theme);
    });
    document.querySelectorAll('[data-auto-next]').forEach(function (row) {
      row.classList.toggle('on', row.dataset.autoNext === settings.autoNext);
    });
    var sw = $('deleteConfirmSwitch');
    if (sw) {
      sw.classList.toggle('on', settings.deleteConfirm);
      sw.parentNode.setAttribute('aria-checked', settings.deleteConfirm ? 'true' : 'false');
    }

    var limit = String(settings.searchLimit);
    document.querySelectorAll('[data-search-limit]').forEach(function (row) {
      row.classList.toggle('on', row.dataset.searchLimit === limit);
    });
    var customInput = $('searchCustomLimit');
    if (customInput) {
      customInput.disabled = limit !== 'custom';
      if (document.activeElement !== customInput) customInput.value = settings.searchCustom;
    }
    var restSwitch = $('loadRestSwitch');
    if (restSwitch) {
      restSwitch.classList.toggle('on', !!settings.showLoadRest);
      restSwitch.parentNode.setAttribute('aria-checked', settings.showLoadRest ? 'true' : 'false');
    }
  }

  function searchBatchSize() {
    if (settings.searchLimit === 'all') return Infinity;
    if (settings.searchLimit === 'custom') return settings.searchCustom;
    return Number(settings.searchLimit) || 50;
  }

  function refreshSearchList() {
    searchState.shown = searchBatchSize();
    if (searchState.chapters.length || searchState.results.length) {
      renderSearchResults();
    } else {
      $('searchMore').hidden = true;
      $('searchRest').hidden = true;
    }
  }

  function setSearchLimit(value) {
    var v = String(value);
    if (v !== 'all' && v !== 'custom' && v !== '50' && v !== '100' && v !== '200') return;
    settings.searchLimit = (v === 'all' || v === 'custom') ? v : Number(v);
    persistSettings();
    renderSettings();
    refreshSearchList();
  }

  function setSearchCustom(value) {
    var n = Math.round(Number(value));
    if (!isFinite(n)) n = settings.searchCustom;
    settings.searchCustom = Math.max(1, Math.min(9999, n));
    persistSettings();
    renderSettings();
    refreshSearchList();
  }

  function toggleLoadRest() {
    settings.showLoadRest = !settings.showLoadRest;
    persistSettings();
    renderSettings();
    refreshSearchList();
    toast(settings.showLoadRest ? '已显示“加载剩余结果”按钮' : '已隐藏“加载剩余结果”按钮');
  }

  function setAutoNext(mode) {
    if (mode !== 'off' && mode !== 'right') return;
    settings.autoNext = mode;
    persistSettings();
    renderSettings();
  }

  function toggleDeleteConfirm() {
    settings.deleteConfirm = !settings.deleteConfirm;
    persistSettings();
    renderSettings();
    toast(settings.deleteConfirm ? '删除确认已开启' : '删除确认已关闭');
  }

  function setConfirmMode(mode) {
    if (mode !== 'tap' && mode !== 'button') return;
    settings.confirm = mode;
    persistSettings();
    renderSettings();
  }

  /* ---------------- 外观（日间/夜间） ---------------- */
  var SUN_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.1" stroke="currentColor" stroke-width="1.8" fill="none"/>'
    + '<path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var MOON_SVG = '<svg viewBox="0 0 24 24"><path d="M20 14.3A8.3 8.3 0 0 1 9.7 4 8.4 8.4 0 1 0 20 14.3z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/></svg>';

  function applyTheme() {
    var night = settings.theme === 'night';
    document.documentElement.setAttribute('data-theme', night ? 'night' : 'day');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', night ? '#12161C' : '#268FF7');
    renderThemeBtn();
  }

  function renderThemeBtn() {
    var btn = $('themeBtn');
    if (!btn) return;
    var night = settings.theme === 'night';
    btn.innerHTML = night ? MOON_SVG : SUN_SVG;
    btn.classList.toggle('night', night);
    btn.setAttribute('aria-label', night ? '切换日间模式' : '切换夜间模式');
    btn.title = night ? '切换到日间模式' : '切换到夜间模式';
  }

  function setThemeMode(mode) {
    if (mode !== 'day' && mode !== 'night') return;
    settings.theme = mode;
    persistSettings();
    applyTheme();
    renderSettings();
  }

  function toggleTheme() {
    setThemeMode(settings.theme === 'night' ? 'day' : 'night');
    toast(settings.theme === 'night' ? '已切换到夜间模式' : '已切换到日间模式');
  }

  /* ---------------- 重置 ---------------- */
  var RESET_NAMES = { wrong: '错题练习', collect: '收藏练习', progress: '做题进度' };
  var pendingReset = null;
  var pendingDelete = null;

  function askReset(type, ex) {
    if (!RESET_NAMES[type]) return;
    pendingReset = { type: type, exam: ex === 4 ? 4 : 1 };
    pendingDelete = null;
    $('confirmTitle').textContent = '重置' + RESET_NAMES[type];
    $('confirmText').textContent = '此操作将会清空' + examName(pendingReset.exam) + '的'
      + RESET_NAMES[type] + '，且无法撤销。';
    $('confirmMask').hidden = false;
  }

  /* 删除确认：根据设置决定是否弹窗，关闭时直接执行 */
  function askDelete(title, text, onOk) {
    if (!settings.deleteConfirm) { onOk(); return; }
    pendingDelete = onOk;
    pendingReset = null;
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmMask').hidden = false;
  }

  function closeConfirm() {
    $('confirmMask').hidden = true;
    pendingReset = null;
    pendingDelete = null;
  }

  function acceptConfirm() {
    if (pendingDelete) {
      var fn = pendingDelete;
      closeConfirm();
      fn();
      return;
    }
    if (!pendingReset) { closeConfirm(); return; }
    var p = pendingReset;
    var st = store[p.exam];
    if (p.type === 'wrong') {
      st.wrong = [];
    } else if (p.type === 'collect') {
      st.collect = [];
    } else {
      st.seq = 0;
      st.ans = {};
      st.right = [];
      st.wrong = [];
    }
    persist();
    closeConfirm();
    renderHome();
    toast('已重置' + RESET_NAMES[p.type]);
  }

  /* ---------------- 章节 ---------------- */
  var GROUPS = {
    1: [
      { title: '科目一 · 汽车驾照', ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17] },
      { title: '灯光模拟', ids: [11] },
      { title: '从业资格', ids: [601, 602, 603, 604] },
      { title: '无人机执照', ids: [701, 702, 703, 704, 705, 706, 707, 708, 709, 710, 711, 712, 713, 714, 715, 716, 717, 718] }
    ],
    4: [
      { title: '科目四 · 安全文明驾驶', ids: [301, 302, 303, 304, 305, 306, 307, 308, 309, 310] }
    ]
  };

  function renderChapters() {
    var box = $('chapterList');
    box.innerHTML = '';
    var groups = GROUPS[exam] || [];
    var used = new Set();
    groups.forEach(function (g) {
      var list = g.ids.map(function (id) { return CHAPTER_MAP.get(id); }).filter(Boolean);
      if (!list.length) return;
      list.forEach(function (c) { used.add(c.id); });
      var title = document.createElement('div');
      title.className = 'chapter-group-title';
      title.textContent = g.title;
      box.appendChild(title);
      list.forEach(function (c) {
        var b = document.createElement('button');
        b.className = 'chapter-row';
        b.dataset.chapter = c.id;
        b.innerHTML = '<span class="name">' + escapeHtml(c.name) + '</span><span class="num">' + c.count + ' 题</span><span class="go">›</span>';
        box.appendChild(b);
      });
    });

    /* 差分包带来的新章节（不在固定分组内） */
    var extra = CHAPTERS.filter(function (c) {
      return c.exam === exam && !used.has(c.id);
    });
    if (extra.length) {
      var extraTitle = document.createElement('div');
      extraTitle.className = 'chapter-group-title';
      extraTitle.textContent = '新增章节';
      box.appendChild(extraTitle);
      extra.forEach(function (c) {
        var b = document.createElement('button');
        b.className = 'chapter-row';
        b.dataset.chapter = c.id;
        b.innerHTML = '<span class="name">' + escapeHtml(c.name) + '</span><span class="num">' + c.count + ' 题</span><span class="go">›</span>';
        box.appendChild(b);
      });
    }
  }

  /* ---------------- 练习 ---------------- */
  function startPractice(mode, chapterId, backTo) {
    var st = store[exam];
    var list, title;

    if (mode === 'chapter') {
      list = QUESTIONS.filter(function (q) { return q.c === chapterId && q.x === exam; });
      var ch = CHAPTER_MAP.get(chapterId);
      title = ch ? ch.name : '章节练习';
    } else if (mode === 'wrong') {
      var wrongSet = new Set(st.wrong);
      list = QUESTIONS.filter(function (q) { return q.x === exam && wrongSet.has(q.i); });
      title = '错题练习';
      if (!list.length) { toast('暂无错题，继续加油'); return; }
    } else if (mode === 'collect') {
      var colSet = new Set(st.collect);
      list = QUESTIONS.filter(function (q) { return q.x === exam && colSet.has(q.i); });
      title = '收藏练习';
      if (!list.length) { toast('暂无收藏'); return; }
    } else if (mode === 'light') {
      list = LIGHT.slice();
      title = '灯光模拟考试';
    } else if (mode === 'random') {
      list = BY_EXAM[exam].slice();
      shuffle(list);
      title = '随机练习';
    } else {
      list = BY_EXAM[exam];
      title = '顺序练习';
    }

    if (!list.length) { toast('该章节暂无题目'); return; }

    var idx = 0;
    if (mode === 'seq') {
      idx = Math.min(Math.max(st.seq || 0, 0), list.length - 1);
    }

    session = {
      exam: exam,
      mode: mode,
      chapterId: chapterId || null,
      title: title,
      list: list,
      idx: idx,
      sel: [],
      revealed: false,
      results: new Map(),
      backTo: backTo || null,
      recite: false
    };

    $('practiceTitle').textContent = title;
    $('chapterChip').hidden = !chapterId;
    if (chapterId) $('chapterChip').textContent = title;

    showScreen('practice');
    renderQuestion(true);
  }

  function startListPractice(list, title, backTo, startIdx, mode) {
    if (!list || !list.length) { toast('没有可练习的题目'); return; }
    session = {
      exam: exam,
      mode: mode || 'picked',
      chapterId: null,
      title: title,
      list: list,
      idx: Math.min(Math.max(startIdx || 0, 0), list.length - 1),
      sel: [],
      revealed: false,
      results: new Map(),
      backTo: backTo || null,
      recite: false
    };
    $('practiceTitle').textContent = title;
    $('chapterChip').hidden = true;
    showScreen('practice');
    renderQuestion(true);
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
  }

  function currentQ() { return session.list[session.idx]; }

  function restoreAnswer(q) {
    var prev = session.results.get(q.i);
    if (prev) {
      session.sel = prev.sel.slice();
      session.revealed = true;
      return;
    }
    var saved = store[session.exam].ans[q.i];
    var autoReveal = session.mode === 'seq' || session.mode === 'random' || session.mode === 'chapter'
      || session.mode === 'picked' || session.mode === 'search';
    if (saved && autoReveal) {
      session.sel = saved.split('');
      session.revealed = true;
      session.results.set(q.i, { sel: session.sel.slice(), ok: null });
    } else {
      session.sel = [];
      session.revealed = false;
    }
  }

  function renderQuestion(scrollTop) {
    var q = currentQ();
    restoreAnswer(q);
    renderReciteBtn();

    var total = session.list.length;
    $('progressText').textContent = '第 ' + (session.idx + 1) + ' / ' + total + ' 题';
    $('progressFill').style.width = ((session.idx + 1) / total * 100) + '%';

    var typeImg = q.y === 1 ? 'icons/ic_quez_type_judge.png'
      : q.y === 3 ? 'icons/ic_quez_type_multiple.png'
      : 'icons/ic_quez_type_single.png';
    $('qtypeImg').src = typeImg;
    $('qtypeImg').alt = q.y === 1 ? '判断题' : q.y === 3 ? '多选题' : '单选题';
    $('qtypeHint').textContent = q.y === 3 ? '多选题，请选择全部正确选项' : '';

    $('qtitle').textContent = (session.idx + 1) + '. ' + q.q;

    var imgs = $('qimgs');
    imgs.innerHTML = '';
    /* 图片放在 640×400 的容器中居中显示，多张图片逐张排列 */
    qImages(q).forEach(function (file) {
      var box = document.createElement('div');
      box.className = 'imgbox';
      var im = document.createElement('img');
      im.src = imgSrc(file);
      im.alt = '题目图片';
      im.className = 'zoomable';
      im.onerror = function () { box.remove(); };
      im.addEventListener('click', function () { openLightbox(im.src); });
      box.appendChild(im);
      imgs.appendChild(box);
    });

    renderOptions(q);
    renderAnalysis(q);
    renderBottom(q);

    if (scrollTop) {
      $('questionScroll').scrollTop = 0;
    }
  }

  function renderOptions(q) {
    var box = $('options');
    box.innerHTML = '';
    var answerSet = new Set(q.a.split(''));
    var selSet = new Set(session.sel);
    var letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    var recite = !!session.recite;

    q.o.forEach(function (text, idx) {
      var letter = letters[idx];
      if (!letter) return;
      var btn = document.createElement('button');
      btn.className = 'option';
      btn.dataset.letter = letter;

      var isSel = selSet.has(letter);
      var isCorrect = answerSet.has(letter);

      if (recite) {
        btn.classList.add('revealed');
        if (isCorrect) btn.classList.add('correct');
      } else if (session.revealed) {
        btn.classList.add('revealed');
        if (isCorrect) btn.classList.add('correct');
        else if (isSel) btn.classList.add('wrong');
      } else if (isSel) {
        btn.classList.add('selected');
      }

      var radio = document.createElement('img');
      radio.className = 'radio';
      radio.src = (isSel && !recite) ? 'icons/ic_radio.png' : 'icons/ic_radio_n.png';
      radio.alt = '';

      var spanLetter = document.createElement('span');
      spanLetter.className = 'letter';
      spanLetter.textContent = letter;

      var spanText = document.createElement('span');
      spanText.className = 'otext';
      spanText.textContent = text;

      btn.appendChild(radio);
      btn.appendChild(spanLetter);
      btn.appendChild(spanText);

      if ((session.revealed || recite) && (isCorrect || (!recite && isSel))) {
        var mark = document.createElement('img');
        mark.className = 'mark';
        mark.src = isCorrect ? 'icons/ic_quiz_correct.png' : 'icons/ic_quiz_wrong.png';
        mark.alt = isCorrect ? '正确' : '错误';
        btn.appendChild(mark);
      }

      btn.addEventListener('click', function () { onSelect(letter); });
      box.appendChild(btn);
    });
  }

  function renderAnalysis(q) {
    var box = $('analysis');
    if (session.recite) {
      var rhtml = '<div class="result-banner recite">'
        + '<span class="ans">正确答案：<b>' + escapeHtml(q.a) + '</b></span>'
        + '</div>'
        + '<div class="analysis-block"><h4>试题解析</h4><p>'
        + (q.e ? escapeHtml(q.e) : '暂无解析')
        + '</p></div>';
      if (q.k) {
        rhtml += '<div class="analysis-block tip"><h4>答题技巧</h4><p>' + escapeHtml(q.k) + '</p></div>';
      }
      if (q.j) {
        rhtml += '<div class="analysis-block tip"><h4>技巧图示</h4>'
          + '<img src="' + imgSrc(q.j) + '" alt="技巧图示" onerror="this.remove()"></div>';
      }
      box.innerHTML = rhtml;
      box.hidden = false;
      return;
    }

    if (!session.revealed) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }

    var ok = q.a.split('').sort().join('') === session.sel.slice().sort().join('');
    var res = session.results.get(q.i);
    if (res) res.ok = ok;

    var html = '';
    html += '<div class="result-banner ' + (ok ? 'right' : 'wrong') + '">'
      + '<img src="' + (ok ? 'icons/ic_quiz_correct.png' : 'icons/ic_quiz_wrong.png') + '" alt="">'
      + (ok ? '回答正确' : '回答错误')
      + '<span class="ans">正确答案：<b>' + escapeHtml(q.a) + '</b></span>'
      + '</div>';

    html += '<div class="analysis-block"><h4>试题解析</h4><p>'
      + (q.e ? escapeHtml(q.e) : '暂无解析')
      + '</p></div>';

    if (q.k) {
      html += '<div class="analysis-block tip"><h4>答题技巧</h4><p>' + escapeHtml(q.k) + '</p></div>';
    }

    if (q.j) {
      html += '<div class="analysis-block tip"><h4>技巧图示</h4>'
        + '<img src="img/' + encodeURIComponent(q.j) + '" alt="技巧图示" onerror="this.remove()"></div>';
    }

    box.innerHTML = html;
    box.hidden = false;
  }

  function renderReciteBtn() {
    var recite = !!(session && session.recite);
    var btn = $('reciteBtn');
    btn.textContent = recite ? '做题' : '背题';
    btn.classList.toggle('on', recite);
  }

  function toggleRecite() {
    if (!session) return;
    clearAutoNext();
    session.recite = !session.recite;
    renderQuestion(false);
  }

  function renderBottom(q) {
    var collected = new Set(store[session.exam].collect).has(q.i);
    $('collectImg').src = collected ? 'icons/ic_quiz_collect2.png' : 'icons/ic_quiz_collect1.png';
    $('collectText').textContent = collected ? '已收藏' : '收藏';
    $('collectBtn').classList.toggle('on', collected);

    var mainBtn = $('mainBtn');
    var nextBtn = $('nextBtn');
    var tapMode = settings.confirm === 'tap';
    var forceConfirm = q.y === 3;   /* 多选题强制使用“确认答案” */

    mainBtn.hidden = tapMode && !forceConfirm;
    nextBtn.hidden = false;
    nextBtn.classList.remove('next', 'primary');
    nextBtn.textContent = '下一题';

    mainBtn.classList.remove('next');
    if (session.recite) {
      mainBtn.textContent = '背题模式';
      mainBtn.disabled = true;
    } else if (!session.revealed) {
      mainBtn.textContent = '确认答案';
      mainBtn.disabled = false;
    } else {
      mainBtn.textContent = '已确认';
      mainBtn.disabled = true;
    }
  }

  function onSelect(letter) {
    if (!session || session.revealed || session.recite) return;
    var q = currentQ();
    var selSet = new Set(session.sel);
    if (q.y === 3) {
      if (selSet.has(letter)) selSet.delete(letter);
      else selSet.add(letter);
      session.sel = Array.from(selSet).sort();
    } else {
      session.sel = [letter];
    }
    renderOptions(q);
    renderBottom(q);

    if (settings.confirm === 'tap' && q.y !== 3) {
      var qid = q.i;
      clearTimeout(autoConfirmTimer);
      autoConfirmTimer = setTimeout(function () {
        if (!session || session.revealed || session.recite) return;
        if (currentQ().i !== qid) return;
        if (!session.sel.length) return;
        confirmAnswer();
      }, 40);
    }
  }

  function confirmAnswer() {
    if (!session) return;
    var q = currentQ();
    if (!session.sel.length) { toast('请先选择答案'); return; }
    var ok = q.a.split('').sort().join('') === session.sel.slice().sort().join('');
    var st = store[session.exam];
    var right = new Set(st.right), wrong = new Set(st.wrong);

    st.ans[q.i] = session.sel.join('');
    if (ok) {
      right.add(q.i); wrong.delete(q.i);
    } else {
      wrong.add(q.i); right.delete(q.i);
    }
    st.right = Array.from(right);
    st.wrong = Array.from(wrong);
    persist();

    session.revealed = true;
    session.results.set(q.i, { sel: session.sel.slice(), ok: ok });
    renderOptions(q);
    renderAnalysis(q);
    renderBottom(q);

    var ansEl = $('analysis');
    if (ansEl && !ansEl.hidden) {
      setTimeout(function () {
        ansEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 40);
    }

    /* 答对自动切换下一题（答错不切换） */
    clearAutoNext();
    if (ok && settings.autoNext === 'right') {
      var qid = q.i;
      autoNextTimer = setTimeout(function () {
        autoNextTimer = null;
        if (!session || $('practice').hidden) return;
        var cur = session.list[session.idx];
        if (!cur || cur.i !== qid) return;
        goNext();
      }, 800);
    }
  }

  function clearAutoNext() {
    if (autoNextTimer) {
      clearTimeout(autoNextTimer);
      autoNextTimer = null;
    }
  }

  function goNext() {
    if (!session) return;
    clearAutoNext();
    if (session.idx >= session.list.length - 1) {
      toast('已完成本轮练习');
      if (session.mode === 'seq') {
        store[exam].seq = 0;
        persist();
      }
      exitPractice();
      return;
    }
    session.idx++;
    saveSeq();
    saveHistoryIdx();
    renderQuestion(true);
  }

  function goPrev() {
    if (!session || session.idx <= 0) {
      if (session && session.idx <= 0) toast('已经是第一题');
      return;
    }
    clearAutoNext();
    session.idx--;
    saveSeq();
    saveHistoryIdx();
    renderQuestion(true);
  }

  function saveSeq() {
    if (session && session.mode === 'seq') {
      store[session.exam].seq = session.idx;
      persist();
    }
  }

  function toggleCollect() {
    var q = currentQ();
    var st = store[session.exam];
    var set = new Set(st.collect);
    if (set.has(q.i)) {
      set.delete(q.i);
      toast('已取消收藏');
    } else {
      set.add(q.i);
      toast('已加入收藏');
    }
    st.collect = Array.from(set);
    persist();
    renderBottom(q);
  }

  function exitPractice() {
    clearAutoNext();
    if (session && session.mode === 'seq') saveSeq();
    saveHistoryIdx();
    var backTo = session && session.backTo;
    session = null;
    if (backTo === 'picker') {
      showScreen('picker');
      renderPicker();
    } else if (backTo === 'search') {
      showScreen('search');
    } else if (backTo === 'chapters') {
      showScreen('chapters');
      renderChapters();
    } else {
      showScreen('home');
      renderHome();
    }
  }

  /* ---------------- 答题卡 ---------------- */
  function renderAnswerCard() {
    if (!session) return;
    var st = store[session.exam];
    var right = new Set(st.right), wrong = new Set(st.wrong);
    var grid = $('cardGrid');
    grid.innerHTML = '';
    var frag = document.createDocumentFragment();

    session.list.forEach(function (q, idx) {
      var cell = document.createElement('button');
      cell.className = 'card-cell';
      if (right.has(q.i)) cell.classList.add('right');
      else if (wrong.has(q.i)) cell.classList.add('wrong');
      if (idx === session.idx) cell.classList.add('current');
      cell.textContent = idx + 1;
      cell.addEventListener('click', function () {
        clearAutoNext();
        session.idx = idx;
        saveSeq();
        saveHistoryIdx();
        closeCard();
        renderQuestion(true);
      });
      frag.appendChild(cell);
    });
    grid.appendChild(frag);

    var cur = grid.children[session.idx];
    $('cardMask').hidden = false;
    if (cur) {
      setTimeout(function () {
        cur.scrollIntoView({ block: 'center' });
      }, 60);
    }
  }

  function closeCard() { $('cardMask').hidden = true; }

  /* ---------------- 图片放大 ---------------- */
  function openLightbox(src) {
    $('lightboxImg').src = src;
    $('lightbox').hidden = false;
  }
  function closeLightbox() { $('lightbox').hidden = true; }

  /* ---------------- 选定内容练习 ---------------- */
  var picker = { chapters: [], questions: [], filter: '', shown: 60, view: [], count: 0 };

  function openPicker() {
    picker.chapters = [];
    picker.questions = [];
    picker.filter = '';
    picker.shown = 60;
    picker.view = [];
    picker.count = 0;
    $('pickerFilter').value = '';
    renderPicker();
    showScreen('picker');
  }

  function renderPicker() {
    renderPickerChapters();
    renderPickerQuestions();
    updatePickerSummary();
    updatePickerCountInput();
  }

  function resetPicker() {
    picker.chapters = [];
    picker.questions = [];
    picker.filter = '';
    picker.shown = 60;
    picker.view = [];
    picker.count = 0;
    $('pickerFilter').value = '';
    renderPicker();
  }

  function pickerPool() {
    if (!picker.chapters.length) return [];
    var set = new Set(picker.chapters);
    return QUESTIONS.filter(function (q) { return set.has(q.c) && q.x === exam; });
  }

  /* 本次可选题目基数：勾选了题目按勾选数，否则按所选章节总题数 */
  function pickerBaseCount() {
    return picker.questions.length ? picker.questions.length : pickerPool().length;
  }

  function updatePickerCountInput() {
    var input = $('pickerCount');
    if (!input) return;
    input.value = picker.count;
    input.disabled = !picker.chapters.length;
  }

  function setPickerCount(n) {
    var max = pickerBaseCount();
    if (max <= 0) { picker.count = 0; updatePickerCountInput(); return; }
    n = Math.round(Number(n));
    if (!isFinite(n) || n < 1) n = 1;
    if (n > max) n = max;
    picker.count = n;
    updatePickerCountInput();
  }

  function stepPickerCount(delta) {
    var cur = Number(picker.count) || pickerBaseCount();
    setPickerCount(cur + delta);
    updatePickerSummary();
  }

  function renderPickerChapters() {
    var sel = new Set(picker.chapters);
    var html = '';
    (GROUPS[exam] || []).forEach(function (g) {
      var list = g.ids.map(function (id) { return CHAPTER_MAP.get(id); }).filter(Boolean);
      if (!list.length) return;
      html += '<div class="picker-group-title">' + escapeHtml(g.title) + '</div>';
      list.forEach(function (c) {
        html += '<button class="pick-chapter' + (sel.has(c.id) ? ' on' : '') + '" data-cid="' + c.id + '">'
          + '<span class="tick">✓</span>'
          + '<span class="cname">' + escapeHtml(c.name)
          + '<span class="ccount">' + c.count + ' 题</span></span>'
          + '</button>';
      });
    });
    $('pickerChapters').innerHTML = html;
  }

  function renderPickerQuestions() {
    var block = $('pickerQBlock');
    var box = $('pickerQuestions');
    var more = $('pickerMore');

    if (!picker.chapters.length) {
      block.hidden = true;
      box.innerHTML = '';
      more.hidden = true;
      $('pickerQHint').textContent = '不勾选则练习整章';
      return;
    }
    block.hidden = false;

    var pool = pickerPool();
    var kw = picker.filter.trim();
    var list = kw ? pool.filter(function (q) { return (q.q || '').indexOf(kw) >= 0; }) : pool;
    picker.view = list;

    var selSet = new Set(picker.questions);
    var shown = list.slice(0, picker.shown);
    var html = '';
    if (!shown.length) {
      html = '<div class="pick-empty">没有匹配的题目</div>';
    } else {
      shown.forEach(function (q) {
        html += '<button class="pick-q' + (selSet.has(q.i) ? ' on' : '') + '" data-qid="' + q.i + '">'
          + '<span class="tick">✓</span>'
          + '<span class="qtext"><span class="qtag">' + typeName(q) + '</span>'
          + escapeHtml(q.q) + '</span></button>';
      });
    }
    box.innerHTML = html;
    more.hidden = list.length <= picker.shown;
    $('pickerQHint').textContent = '共 ' + pool.length + ' 题' + (kw ? '，匹配 ' + list.length + ' 题' : '');
  }

  function updatePickerSummary() {
    var btn = $('pickerStart');
    var el = $('pickerSummary');
    if (!picker.chapters.length) {
      el.textContent = '请先选择章节';
      btn.disabled = true;
      return;
    }
    var pool = pickerPool().length;
    var base = picker.questions.length || pool;
    var want = Math.min(Math.max(picker.count || base, 1), base);
    btn.disabled = !base;
    if (picker.questions.length) {
      el.innerHTML = '已选 <b>' + picker.chapters.length + '</b> 个章节 · 勾选 <b>' + picker.questions.length
        + '</b> 题 · 随机抽取 <b>' + want + '</b> 题';
    } else {
      el.innerHTML = '已选 <b>' + picker.chapters.length + '</b> 个章节 · 共 <b>' + pool
        + '</b> 题 · 随机抽取 <b>' + want + '</b> 题';
    }
  }

  function togglePickerChapter(id) {
    var i = picker.chapters.indexOf(id);
    if (i >= 0) picker.chapters.splice(i, 1);
    else picker.chapters.push(id);

    var pool = new Set(pickerPool().map(function (q) { return q.i; }));
    picker.questions = picker.questions.filter(function (qi) { return pool.has(qi); });
    picker.shown = 60;
    /* 章节变化后，题数默认恢复为当前可选题目总数 */
    setPickerCount(pickerBaseCount());
    renderPickerChapters();
    renderPickerQuestions();
    updatePickerSummary();
  }

  function togglePickQuestion(id) {
    var i = picker.questions.indexOf(id);
    if (i >= 0) picker.questions.splice(i, 1);
    else picker.questions.push(id);
    var btn = document.querySelector('.pick-q[data-qid="' + id + '"]');
    if (btn) btn.classList.toggle('on', picker.questions.indexOf(id) >= 0);
    /* 取消全部勾选时恢复为章节总题数，否则只做上限约束 */
    setPickerCount(picker.questions.length ? picker.count : pickerPool().length);
    updatePickerSummary();
  }

  function pickerSelectAll() {
    var set = new Set(picker.questions);
    (picker.view || []).forEach(function (q) { set.add(q.i); });
    picker.questions = Array.from(set);
    setPickerCount(picker.count);
    renderPickerQuestions();
    updatePickerSummary();
  }

  function pickerSelectNone() {
    picker.questions = [];
    setPickerCount(pickerPool().length);
    renderPickerQuestions();
    updatePickerSummary();
  }

  /* 历史记录默认标题：章节名 + 共N题 */
  function defaultHistoryTitle(chapterIds, count) {
    var names = chapterIds.map(chapterName).filter(Boolean);
    var prefix = names.length > 2 ? names.slice(0, 2).join('、') + ' 等' : names.join('、');
    return (prefix || '选定内容') + '共' + count + '题';
  }

  /* 创建一条历史记录，返回记录对象 */
  function addHistoryRecord(chapterIds, list) {
    var now = new Date();
    var rec = {
      id: 'h' + now.getTime() + Math.floor(Math.random() * 1000),
      exam: exam,
      title: defaultHistoryTitle(chapterIds, list.length),
      createdAt: formatTime(now),
      ts: now.getTime(),
      qids: list.map(function (q) { return q.i; }),
      idx: 0,
      chapterIds: chapterIds
    };
    pickHist.unshift(rec);
    persistHistory();
    return rec;
  }

  function startPickerPractice() {
    if (!picker.chapters.length) { toast('请先选择章节'); return; }
    var list;
    if (picker.questions.length) {
      var set = new Set(picker.questions);
      list = QUESTIONS.filter(function (q) { return set.has(q.i); });
    } else {
      list = pickerPool();
    }
    if (!list.length) { toast('所选章节暂无题目'); return; }
    var total = list.length;
    var want = Math.min(Math.max(Math.round(Number(picker.count)) || total, 1), total);
    shuffle(list);
    var chosen = list.slice(0, want);
    var rec = addHistoryRecord(picker.chapters.slice(), chosen);
    startListPractice(chosen, rec.title, 'picker', 0, 'picked');
    session.historyId = rec.id;
  }

  /* ---------------- 题库搜索 ---------------- */
  var searchState = { scope: 'all', qtype: 0, kw: '', mode: 'q', results: [], chapters: [], shown: 40 };
  var searchSelected = new Set();
  var searchTimer = null;

  function openSearch() {
    showScreen('search');
    if (!$('searchResults').children.length) {
      $('searchMeta').textContent = '输入关键词开始搜索';
    }
    setTimeout(function () { $('searchInput').focus(); }, 80);
  }

  function typeName(q) {
    return q.y === 1 ? '判断' : q.y === 3 ? '多选' : '单选';
  }

  function examName(x) {
    return x === 4 ? '科目四' : '科目一';
  }

  function chapterName(id) {
    var c = CHAPTER_MAP.get(id);
    return c ? c.name : '';
  }

  function answerText(q) {
    if (q.y === 1) return q.a + '（' + (q.a === 'A' ? '正确' : '错误') + '）';
    return q.a;
  }

  function doSearch() {
    var kw = ($('searchInput').value || '').trim();
    searchState.kw = kw;
    searchState.shown = searchBatchSize();
    $('searchClear').classList.toggle('on', !!kw);
    clearTimeout(searchTimer);

    if (searchState.scope === 'c') {
      searchState.mode = 'c';
      var lower = kw.toLowerCase();
      searchState.chapters = CHAPTERS.filter(function (c) {
        return !kw || c.name.toLowerCase().indexOf(lower) >= 0;
      });
      renderSearchResults();
      return;
    }

    if (!kw && searchState.scope !== 'k') {
      searchState.mode = 'q';
      searchState.results = [];
      searchSelected.clear();
      updateSelectBar();
      $('searchResults').innerHTML = '';
      $('searchMore').hidden = true;
      $('searchRest').hidden = true;
      $('searchMeta').textContent = '输入关键词开始搜索（答题技巧留空可列出全部技巧）';
      return;
    }

    searchState.mode = 'q';
    searchState.results = findQuestions();
    renderSearchResults();
  }

  function findQuestions() {
    var kw = searchState.kw;
    var scope = searchState.scope;
    var qtype = searchState.qtype;
    var kwUpper = kw.toUpperCase();
    var out = [];
    for (var i = 0; i < QUESTIONS.length; i++) {
      var q = QUESTIONS[i];
      if (qtype && q.y !== qtype) continue;
      var hit = false;
      if (scope === 'q') {
        hit = (q.q || '').indexOf(kw) >= 0;
      } else if (scope === 'e') {
        hit = (q.e || '').indexOf(kw) >= 0;
      } else if (scope === 'k') {
        hit = kw ? (q.k || '').indexOf(kw) >= 0 : !!q.k;
      } else if (scope === 'a') {
        hit = q.a.indexOf(kwUpper) >= 0;
        if (!hit && q.y === 1) hit = (q.a === 'A' ? '正确' : '错误').indexOf(kw) >= 0;
      } else {
        hit = (q.q || '').indexOf(kw) >= 0 || (q.e || '').indexOf(kw) >= 0 || (q.k || '').indexOf(kw) >= 0;
      }
      if (hit) out.push(q);
    }
    return out;
  }

  function renderSearchResults() {
    var box = $('searchResults');
    var meta = $('searchMeta');

    if (searchState.mode === 'c') {
      searchSelected.clear();
      updateSelectBar();
      var totalC = searchState.chapters.length;
      var shownC = Math.min(searchState.shown, totalC);
      var clist = searchState.chapters.slice(0, shownC);
      meta.textContent = totalC
        ? ('共 ' + totalC + ' 个章节')
        : '没有找到相关章节';
      box.innerHTML = clist.map(function (c) {
        return '<button class="search-item chapter-item" data-scid="' + c.id + '">'
          + '<span class="ci-main"><span class="ci-name">' + highlight(c.name, searchState.kw) + '</span>'
          + '<span class="ci-meta">' + examName(c.exam) + ' · ' + c.count + ' 题</span></span>'
          + '<span class="go">›</span></button>';
      }).join('');
      updateSearchPager(totalC, shownC);
      return;
    }

    var totalQ = searchState.results.length;
    var shownQ = Math.min(searchState.shown, totalQ);
    var list = searchState.results.slice(0, shownQ);
    meta.textContent = totalQ
      ? ('找到 ' + totalQ + ' 道相关题目')
      : '没有找到相关内容';

    var resIds = new Set(searchState.results.map(function (q) { return q.i; }));
    searchSelected.forEach(function (id) {
      if (!resIds.has(id)) searchSelected.delete(id);
    });

    var collected = {
      1: new Set(store[1].collect),
      4: new Set(store[4].collect)
    };

    box.innerHTML = list.map(function (q) {
      var scope = searchState.scope;
      var main, sub;
      if (scope === 'k') {
        main = snippetHtml(q.k, searchState.kw, 90);
        sub = '<span class="lab">题目：</span>' + snippetHtml(q.q, '', 50);
      } else if (scope === 'e') {
        main = snippetHtml(q.e, searchState.kw, 90);
        sub = '<span class="lab">题目：</span>' + snippetHtml(q.q, searchState.kw, 46)
          + ' <span class="si-ans">答案 ' + escapeHtml(q.a) + '</span>';
      } else if (scope === 'a') {
        main = snippetHtml(q.q, '', 100);
        sub = '<span class="lab">答案：</span><span class="si-ans">' + escapeHtml(answerText(q)) + '</span>';
      } else {
        main = snippetHtml(q.q, searchState.kw, 100);
        sub = '<span class="lab">答案：</span><span class="si-ans">' + escapeHtml(answerText(q)) + '</span>';
      }

      var imgs = qImages(q);
      var thumbs = '';
      if (imgs.length) {
        thumbs = '<div class="si-thumbs">' + imgs.map(function (f) {
          return '<img src="' + imgSrc(f) + '" alt="题目图片" onerror="this.remove()">';
        }).join('') + '</div>';
      }

      var picked = searchSelected.has(q.i);
      var col = collected[q.x].has(q.i);

      return '<div class="search-item' + (picked ? ' selected' : '') + '" data-item="' + q.i + '">'
        + '<button class="si-main" data-sqi="' + q.i + '">'
        + '<div class="si-head"><span class="si-type">' + typeName(q) + '</span>'
        + '<span>' + examName(q.x) + '</span>'
        + '<span class="si-chapter">' + escapeHtml(chapterName(q.c)) + '</span></div>'
        + '<div class="si-text">' + main + '</div>'
        + '<div class="si-sub">' + sub + '</div>'
        + thumbs
        + '</button>'
        + '<div class="si-actions">'
        + '<button class="si-act' + (picked ? ' on' : '') + '" data-si-pick="' + q.i + '">'
        + (picked ? '已选' : '选择') + '</button>'
        + '<button class="si-act' + (col ? ' col' : '') + '" data-si-collect="' + q.i + '">'
        + (col ? '已藏' : '收藏') + '</button>'
        + '</div></div>';
    }).join('');
    updateSearchPager(totalQ, shownQ);
    updateSelectBar();
  }

  function updateSearchPager(total, shown) {
    $('searchMore').hidden = total <= shown;
    $('searchRest').hidden = !(settings.showLoadRest && total > shown);
  }

  function searchTotal() {
    return searchState.mode === 'c' ? searchState.chapters.length : searchState.results.length;
  }

  function searchLoadMore() {
    var total = searchTotal();
    searchState.shown = Math.min(searchState.shown + searchBatchSize(), total);
    renderSearchResults();
  }

  function searchLoadRest() {
    searchState.shown = searchTotal();
    renderSearchResults();
  }

  function qImages(q) {
    if (!q || !q.p) return [];
    return String(q.p).split(/[,|;]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function updateSelectBar() {
    $('selectBar').hidden = searchSelected.size === 0;
  }

  function updateSearchItem(id) {
    var item = document.querySelector('.search-item[data-item="' + id + '"]');
    if (!item) return;
    var on = searchSelected.has(id);
    item.classList.toggle('selected', on);
    var pick = item.querySelector('[data-si-pick]');
    if (pick) {
      pick.classList.toggle('on', on);
      pick.textContent = on ? '已选' : '选择';
    }
  }

  function toggleSearchSelect(id) {
    if (searchSelected.has(id)) searchSelected.delete(id);
    else searchSelected.add(id);
    updateSearchItem(id);
    updateSelectBar();
  }

  function searchSelectAll() {
    searchState.results.forEach(function (q) { searchSelected.add(q.i); });
    renderSearchResults();
  }

  function searchClearSel() {
    searchSelected.clear();
    renderSearchResults();
  }

  function updateSearchCollectBtn(id) {
    var q = QMAP.get(id);
    if (!q) return;
    var item = document.querySelector('.search-item[data-item="' + id + '"]');
    if (!item) return;
    var col = new Set(store[q.x].collect).has(id);
    var btn = item.querySelector('[data-si-collect]');
    if (btn) {
      btn.classList.toggle('col', col);
      btn.textContent = col ? '已藏' : '收藏';
    }
  }

  function toggleSearchCollect(id) {
    var q = QMAP.get(id);
    if (!q) return;
    var st = store[q.x];
    var set = new Set(st.collect);
    var added = !set.has(id);
    if (added) set.add(id);
    else set.delete(id);
    st.collect = Array.from(set);
    persist();
    updateSearchCollectBtn(id);
    toast(added ? '已收藏' : '已取消收藏');
  }

  function collectSelected() {
    var n = 0;
    searchSelected.forEach(function (id) {
      var q = QMAP.get(id);
      if (!q) return;
      var st = store[q.x];
      var set = new Set(st.collect);
      if (!set.has(id)) {
        set.add(id);
        st.collect = Array.from(set);
        n++;
      }
    });
    if (!n) { toast('所选题目均已收藏'); return; }
    persist();
    searchSelected.forEach(updateSearchCollectBtn);
    toast('已收藏 ' + n + ' 题');
  }

  function startSearchQuestion(qid) {
    var q = QMAP.get(qid);
    if (!q) return;
    var list = searchState.results.filter(function (x) { return x.x === q.x; });
    var idx = list.indexOf(q);
    if (idx < 0) { list = [q]; idx = 0; }
    exam = q.x;
    renderHome();
    startListPractice(list, '搜索结果', 'search', idx, 'search');
  }

  function startSearchChapter(cid) {
    var c = CHAPTER_MAP.get(cid);
    if (!c) return;
    exam = c.exam;
    renderHome();
    startPractice('chapter', c.id, 'search');
  }

  function highlight(text, kw) {
    if (!kw) return escapeHtml(text);
    var t = String(text == null ? '' : text);
    var lower = t.toLowerCase();
    var k = kw.toLowerCase();
    var out = '';
    var pos = 0;
    while (pos <= t.length) {
      var i = lower.indexOf(k, pos);
      if (i < 0) { out += escapeHtml(t.slice(pos)); break; }
      out += escapeHtml(t.slice(pos, i)) + '<mark>' + escapeHtml(t.slice(i, i + k.length)) + '</mark>';
      pos = i + k.length;
    }
    return out;
  }

  function snippetHtml(text, kw, len) {
    var t = String(text == null ? '' : text);
    if (!t) return '';
    if (kw) {
      var i = t.toLowerCase().indexOf(kw.toLowerCase());
      if (i >= 0) {
        var start = Math.max(0, i - 24);
        var end = Math.min(t.length, i + kw.length + len);
        return (start > 0 ? '…' : '') + highlight(t.slice(start, end), kw) + (end < t.length ? '…' : '');
      }
    }
    return escapeHtml(t.length > len + 20 ? t.slice(0, len + 20) + '…' : t);
  }

  /* ---------------- 工具 ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1600);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- 事件 ---------------- */
  document.addEventListener('click', function (e) {
    var target = e.target.closest('[data-action]');
    if (target) {
      var action = target.dataset.action;
      if (action === 'home') showScreen('home');
      else if (action === 'exitPractice') exitPractice();
      else if (action === 'answerCard') renderAnswerCard();
      else if (action === 'closeCard') closeCard();
      else if (action === 'collect') toggleCollect();
      else if (action === 'prev') goPrev();
      else if (action === 'main') confirmAnswer();
      else if (action === 'openSearch') openSearch();
      else if (action === 'closeSearch') {
        searchSelected.clear();
        updateSelectBar();
        showScreen('home');
        renderHome();
      }
      else if (action === 'searchClear') {
        $('searchInput').value = '';
        $('searchClear').classList.remove('on');
        doSearch();
        $('searchInput').focus();
      } else if (action === 'doSearch') doSearch();
      else if (action === 'searchMore') searchLoadMore();
      else if (action === 'searchLoadRest') searchLoadRest();
      else if (action === 'searchSelectAll') searchSelectAll();
      else if (action === 'searchCollectSel') collectSelected();
      else if (action === 'searchClearSel') searchClearSel();
      else if (action === 'closePicker') { showScreen('home'); renderHome(); }
      else if (action === 'pickerReset') resetPicker();
      else if (action === 'pickerAll') pickerSelectAll();
      else if (action === 'pickerNone') pickerSelectNone();
      else if (action === 'pickerMore') {
        picker.shown += 60;
        renderPickerQuestions();
      } else if (action === 'pickerStart') startPickerPractice();
      else if (action === 'pickerCountMinus') stepPickerCount(-1);
      else if (action === 'pickerCountPlus') stepPickerCount(1);
      else if (action === 'historyDelete') deleteSelectedHistory();
      else if (action === 'openSettings') openSettings();
      else if (action === 'closeSettings') { showScreen('home'); renderHome(); }
      else if (action === 'toggleRecite') toggleRecite();
      else if (action === 'toggleTheme') toggleTheme();
      else if (action === 'confirmCancel') closeConfirm();
      else if (action === 'confirmOk') acceptConfirm();
      else if (action === 'closeHistory') { showScreen('home'); renderHome(); }
      else if (action === 'nextBtn') goNext();
      return;
    }

    var resetRow = e.target.closest('[data-reset]');
    if (resetRow) {
      askReset(resetRow.dataset.reset, Number(resetRow.dataset.exam));
      return;
    }

    var themeRow = e.target.closest('[data-theme-mode]');
    if (themeRow) {
      setThemeMode(themeRow.dataset.themeMode);
      return;
    }

    var autoNextRow = e.target.closest('[data-auto-next]');
    if (autoNextRow) {
      setAutoNext(autoNextRow.dataset.autoNext);
      return;
    }

    var delConfirmRow = e.target.closest('[data-del-confirm-toggle]');
    if (delConfirmRow) {
      toggleDeleteConfirm();
      return;
    }

    var searchLimitRow = e.target.closest('[data-search-limit]');
    if (searchLimitRow) {
      setSearchLimit(searchLimitRow.dataset.searchLimit);
      return;
    }

    var loadRestRow = e.target.closest('[data-load-rest-toggle]');
    if (loadRestRow) {
      toggleLoadRest();
      return;
    }

    var settingRow = e.target.closest('.setting-row');
    if (settingRow && settingRow.dataset.confirm) {
      setConfirmMode(settingRow.dataset.confirm);
      return;
    }

    var pickSelBtn = e.target.closest('[data-si-pick]');
    if (pickSelBtn) {
      toggleSearchSelect(Number(pickSelBtn.dataset.siPick));
      return;
    }

    var collectBtn = e.target.closest('[data-si-collect]');
    if (collectBtn) {
      toggleSearchCollect(Number(collectBtn.dataset.siCollect));
      return;
    }

    var chip = e.target.closest('.chip');
    if (chip) {
      if (chip.dataset.scope) {
        searchState.scope = chip.dataset.scope;
        document.querySelectorAll('#scopeChips .chip').forEach(function (c) {
          c.classList.toggle('active', c === chip);
        });
      } else if (chip.dataset.qtype !== undefined) {
        searchState.qtype = Number(chip.dataset.qtype);
        document.querySelectorAll('#typeChips .chip').forEach(function (c) {
          c.classList.toggle('active', c === chip);
        });
      }
      doSearch();
      return;
    }

    var pickChapter = e.target.closest('.pick-chapter');
    if (pickChapter) {
      togglePickerChapter(Number(pickChapter.dataset.cid));
      return;
    }

    var pickQ = e.target.closest('.pick-q');
    if (pickQ) {
      togglePickQuestion(Number(pickQ.dataset.qid));
      return;
    }

    var histCheck = e.target.closest('[data-hist-check]');
    if (histCheck) {
      toggleHistorySel(histCheck.dataset.histCheck);
      return;
    }

    var histRename = e.target.closest('[data-hist-rename]');
    if (histRename) {
      startRenameHistory(histRename.dataset.histRename);
      return;
    }

    var histDel = e.target.closest('[data-hist-del]');
    if (histDel) {
      deleteHistory(histDel.dataset.histDel);
      return;
    }

    var histOpen = e.target.closest('[data-hist-open]');
    if (histOpen) {
      openHistory(histOpen.dataset.histOpen);
      return;
    }

    var sQuestion = e.target.closest('[data-sqi]');
    if (sQuestion) {
      startSearchQuestion(Number(sQuestion.dataset.sqi));
      return;
    }

    var sChapter = e.target.closest('[data-scid]');
    if (sChapter) {
      startSearchChapter(Number(sChapter.dataset.scid));
      return;
    }

    var tab = e.target.closest('.subject-tab');
    if (tab) {
      exam = Number(tab.dataset.exam);
      renderHome();
      renderChapters();
      return;
    }

    var modeRow = e.target.closest('.mode-row');
    if (modeRow) {
      var mode = modeRow.dataset.mode;
      if (mode === 'chapter') {
        renderChapters();
        showScreen('chapters');
      } else if (mode === 'picked') {
        openPicker();
      } else if (mode === 'history') {
        openHistoryScreen();
      } else {
        startPractice(mode);
      }
      return;
    }

    var chapterRow = e.target.closest('.chapter-row');
    if (chapterRow) {
      /* 从章节列表进入练习，返回时回到章节列表 */
      startPractice('chapter', Number(chapterRow.dataset.chapter), 'chapters');
      return;
    }
  });

  $('cardMask').addEventListener('click', function (e) {
    if (e.target === $('cardMask')) closeCard();
  });
  $('lightbox').addEventListener('click', closeLightbox);
  $('confirmMask').addEventListener('click', function (e) {
    if (e.target === $('confirmMask')) closeConfirm();
  });

  $('searchInput').addEventListener('input', function () {
    $('searchClear').classList.toggle('on', !!this.value.trim());
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 280);
  });
  $('searchInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchTimer);
      doSearch();
    }
  });
  $('pickerFilter').addEventListener('input', function () {
    picker.filter = this.value;
    picker.shown = 60;
    renderPickerQuestions();
  });
  $('pickerCount').addEventListener('input', function () {
    var n = parseInt(this.value, 10);
    picker.count = isFinite(n) ? n : 0;
    updatePickerSummary();
  });
  $('pickerCount').addEventListener('change', function () {
    setPickerCount(this.value);
    updatePickerSummary();
  });
  $('pickerCount').addEventListener('blur', function () {
    setPickerCount(this.value);
    updatePickerSummary();
  });

  document.addEventListener('keydown', function (e) {
    if ($('practice').hidden) return;
    if (!$('lightbox').hidden) {
      if (e.key === 'Escape') closeLightbox();
      return;
    }
    if (!$('cardMask').hidden) {
      if (e.key === 'Escape') closeCard();
      return;
    }
    var k = e.key.toUpperCase();
    var letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    if (letters.indexOf(k) >= 0) {
      onSelect(k);
    } else if (k === '1' || k === '2' || k === '3' || k === '4') {
      onSelect(letters[Number(k) - 1]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goNext();
    } else if (e.key === 'ArrowRight') {
      goNext();
    } else if (e.key === 'ArrowLeft') {
      goPrev();
    } else if (k === 'C') {
      toggleCollect();
    } else if (e.key === 'Escape') {
      exitPractice();
    }
  });

  var customLimitInput = $('searchCustomLimit');
  if (customLimitInput) {
    customLimitInput.addEventListener('change', function () { setSearchCustom(this.value); });
    customLimitInput.addEventListener('blur', function () { setSearchCustom(this.value); });
  }

  /* ---------------- 启动 ---------------- */
  applyTheme();
  renderHome();
  renderChapters();
})();
