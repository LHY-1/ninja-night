/* 忍者之夜 · 前端 */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const S = {
    screen: 'home',
    view: null,
    code: '',
    token: '',
    name: localStorage.getItem('rz.name') || '',
    avatar: 0,
    meta: null,
    error: '',
    submitting: false,
    lastJson: '',
    lastLogId: 0,
    lastRound: -1,
    resultOpen: true,
    logsOpen: false,
    nameOpen: false,
    renameDraft: '',
    editTarget: null,
    chatOpen: false,
    chatDraft: '',
    lastMsgId: 0,
    menuOpen: false,
    chatBubble: null,
    bubbles: {},
    seenMsgId: 0,
    personTarget: null,
    lastBubbleId: 0,
    bubbleTimer: null,
    activeReveals: [],
    lastRevealId: 0,
    revealTimer: null,
    online: true,
  };

  let es = null;

  /* ---------------- 基础 ---------------- */

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function chatUnread(view) {
    if (S.chatOpen) return 0;
    const msgs = (view && view.messages) || [];
    const mine = (view && view.you && view.you.id) || '';
    const last = S.lastMsgId || 0;
    return msgs.filter((m) => m.id > last && m.from !== mine).length;
  }

  function chatBadge(view) {
    const n = chatUnread(view);
    if (!n) return '';
    return `<i>${n > 9 ? '9+' : n}</i>`;
  }

  function avatarHtml(av, clickable) {
    const a = av || { ch: '?', color: '#3a4f63' };
    if (clickable) {
      return `<button class="avatar is-btn" data-act="nextAvatar" style="--av:${esc(a.color)}" title="点一下换个头像">${esc(a.ch)}</button>`;
    }
    return `<span class="avatar" style="--av:${esc(a.color)}">${esc(a.ch)}</span>`;
  }

  async function post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
    return data;
  }

  function toast(msg, kind) {
    document.querySelectorAll('.toast').forEach((el) => el.remove());
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 260);
    }, kind === 'secret' ? 5200 : 2600);
  }

  /* ---------------- 连接 ---------------- */

  function startStream() {
    if (es) { es.close(); es = null; }
    localStorage.setItem('rz.code', S.code);
    localStorage.setItem('rz.token', S.token);
    const url = `/api/stream?code=${encodeURIComponent(S.code)}&token=${encodeURIComponent(S.token)}`;
    es = new EventSource(url);
    es.onopen = () => { S.online = true; };
    es.onmessage = (e) => {
      try {
        S.view = JSON.parse(e.data);
        S.error = '';
        render();
      } catch (err) { console.error('render failed:', err && err.message, err && err.stack); }
    };
    es.onerror = () => { S.online = false; render(); };
    history.replaceState(null, '', `${location.pathname}?r=${S.code}`);
  }

  /* ---------------- 启动 ---------------- */

  async function loadMeta() {
    try {
      const res = await fetch('/api/meta');
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function boot() {
    S.meta = await loadMeta();
    const savedAvatar = localStorage.getItem('rz.avatar');
    S.avatar = savedAvatar !== null
      ? (Number(savedAvatar) || 0) % metaAvatars().length
      : Math.floor(Math.random() * metaAvatars().length);

    const params = new URLSearchParams(location.search);
    const urlCode = (params.get('r') || '').trim().toUpperCase();
    const savedCode = localStorage.getItem('rz.code') || '';
    const savedToken = localStorage.getItem('rz.token') || '';
    S.name = localStorage.getItem('rz.name') || '';

    const tryCode = urlCode || savedCode;
    if (tryCode && savedToken) {
      try {
        const r = await post('/api/join', { code: tryCode, token: savedToken, name: S.name });
        S.code = r.code; S.token = r.token;
        startStream();
        return;
      } catch (err) {
        localStorage.removeItem('rz.token');
      }
    }
    if (urlCode) S.joinCode = urlCode;
    S.screen = 'home';
    render();
  }

  /* ---------------- 渲染 ---------------- */

  function render() {
    const app = $('#app');

    if (!S.view) { app.innerHTML = homeHtml(); S.lastJson = ''; return; }

    const view = S.view;
    if (S.lastRound !== view.round) {
      S.lastRound = view.round;
      S.resultOpen = true;
      S.bubbles = {};
    }

    const firstPaint = !S.lastJson;
    if (firstPaint) {
      if (S.view.messages && S.view.messages.length) {
        S.lastMsgId = S.view.messages[S.view.messages.length - 1].id;
        S.lastBubbleId = S.lastMsgId;
        S.seenMsgId = S.lastMsgId;
      }
      const list = view.reveals || [];
      S.lastRevealId = list.length ? list[list.length - 1].id : 0;
      S.activeReveals = [];
    } else {
      handleReveals(view);
      trackBubbles(view);
    }

    const unread = chatUnread(view);
    const sig = JSON.stringify(view) + '|' + S.error + '|' + S.online + '|' + S.resultOpen + '|' + S.logsOpen + '|' + S.nameOpen + '|' + S.editTarget + '|' + S.chatOpen + '|' + unread + '|' + (S.chatBubble ? S.chatBubble.id : '') + '|' + S.menuOpen + '|' + S.personTarget
      + '|' + (S.activeReveals || []).map((r) => r.id).join(',');
    if (sig === S.lastJson) return;
    S.lastJson = sig;

    const scroller = $('.scroll');
    const prevTop = scroller ? scroller.scrollTop : 0;
    const sheet = $('.result-sheet');
    const prevSheetTop = sheet ? sheet.scrollTop : 0;
    const prevChat = $('#chatBody');
    const chatAtBottom = prevChat ? (prevChat.scrollHeight - prevChat.scrollTop - prevChat.clientHeight) < 60 : true;

    app.innerHTML = view.phase === 'lobby' ? lobbyHtml(view) : gameHtml(view);

    if (S.chatOpen && view.messages && view.messages.length) S.lastMsgId = view.messages[view.messages.length - 1].id;

    const newScroller = $('.scroll');
    if (newScroller) newScroller.scrollTop = firstPaint ? 0 : prevTop;
    const newSheet = $('.result-sheet');
    if (newSheet) newSheet.scrollTop = prevSheetTop;
    const lsBody = $('#lsBody');
    if (lsBody) lsBody.scrollTop = lsBody.scrollHeight;
    const chatBodyEl = $('#chatBody');
    if (chatBodyEl && chatAtBottom) chatBodyEl.scrollTop = chatBodyEl.scrollHeight;

    if (!firstPaint) notifySecret(view);
    else S.lastLogId = view.logs.length ? view.logs[view.logs.length - 1].id : 0;
  }

  function highlightNames(text, view) {
    let safe = esc(text);
    const names = (view.players || []).map((p) => p.name).filter(Boolean)
      .sort((a, b) => b.length - a.length);
    if (!names.length) return safe;
    const pattern = names.map((n) => esc(n).replace(/[.*+?^${}()|[\]\\]/g, '\\  function notifySecret(view) {')).join('|');
    try {
      safe = safe.replace(new RegExp('(' + pattern + ')', 'g'), '<b class="hl">$1</b>');
    } catch (e) { /* 名字里有正则特殊字符时放弃高亮 */ }
    return safe;
  }

  function notifySecret(view) {
    if (!['draft1', 'draft2', 'night'].includes(view.phase)) {
      if (view.logs.length) S.lastLogId = view.logs[view.logs.length - 1].id;
      return;
    }
    const fresh = view.logs.filter((l) => l.id > S.lastLogId && l.to);
    if (fresh.length) fresh.slice(-2).forEach((l) => toast(l.text, 'secret'));
    if (view.logs.length) S.lastLogId = view.logs[view.logs.length - 1].id;
  }

  /* ---------------- 首页 ---------------- */

  function metaAvatars() {
    const list = S.meta && Array.isArray(S.meta.avatars) ? S.meta.avatars : null;
    return list && list.length ? list : [{ ch: '忍', color: '#8d2f28' }];
  }

  function homeChar() {
    const chars = Array.from(String(S.name || '').trim());
    return chars.length ? chars[0].toUpperCase() : '忍';
  }

  function homeHtml() {
    const avs = metaAvatars();
    const av = avs[S.avatar % avs.length];
    return `
<div class="screen">
  <div class="home">
    <div class="brand">
      <svg class="shuriken" viewBox="0 0 32 32" fill="none">
        <path d="M16 2.5l3.4 8.6 8.6 3.4-8.6 3.4L16 29.5l-3.4-9.6L4 16.5l8.6-3.4z"
              stroke="#d9b45f" stroke-width="1.2" fill="rgba(217,180,95,.12)"/>
        <circle cx="16" cy="16" r="2" fill="#d9b45f"/>
      </svg>
      <h1 class="serif">忍者之夜</h1>
      <p class="tagline">4–11 人 · 同一 WiFi · 一个晚上定生死</p>
    </div>

    <div class="panel">
      ${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}

      <div class="identity">
        <button class="avatar avatar-lg is-btn" data-act="cycleAvatar"
                style="--av:${esc(av.color)}" title="点一下换个配色">${esc(homeChar())}</button>
        <div class="identity-fields">
          <label>你的昵称</label>
          <input class="input" id="nameInput" maxlength="12" placeholder="取个名字"
                 value="${esc(S.name)}" autocomplete="off">
        </div>
      </div>
      <p class="hint-sm">头像点一下就换。整局的提示都会用这个昵称，别用「玩家2」这种名字，不然大家分不清谁是谁。</p>

      <button class="btn btn-primary btn-block" data-act="create">创建房间</button>

      <div class="divider">或者加入</div>
      <div class="field">
        <label>房号</label>
        <input class="input" id="codeInput" maxlength="4" placeholder="4 位房号" value="${esc(S.joinCode || '')}"
               autocomplete="off" autocapitalize="characters" style="letter-spacing:.28em;text-transform:uppercase">
      </div>
      <button class="btn btn-block" data-act="join">加入房间</button>
    </div>

    <p class="hint">一台电脑开服务，其他人用手机浏览器访问它的局域网地址。<br>出局了还能说话 —— 建议当面玩。</p>
  </div>
</div>`;
  }

  /** 身份标签：公开或查到的 + 自己记的笔记 */
  function identityTags(p, clickable) {
    const real = p.campLabel
      ? `<span class="ctag ${p.campKey || 'unknown'} ${p.isIntel ? 'intel' : ''}" title="${p.isIntel ? '你查看过他的阵营' : '身份已公开'}">${esc(p.campLabel)}</span>`
      : '<span class="ctag unknown">?</span>';
    const note = p.noteLabel
      ? `<span class="ctag ${p.noteCamp || 'unknown'} note"${clickable ? ` data-act="editCamp" data-id="${esc(p.id)}" title="点一下改自己的标记"` : ' title="你自己记的笔记"'}>记 ${esc(p.noteLabel)}</span>`
      : '';
    return real + note;
  }

  function playerChip(p, lobby, canManage, canRename) {
    const me = p.isYou;
    const bubble = liveBubble(p.id);
    const nameEditable = !!(me && canRename);
    const editable = !!p.canEdit;  /* 标记是每人自己的私人笔记,不该限房主 */
    const tags = lobby
      ? `${p.isBot ? '<span class="ctag bot">人机</span>' : ''}${p.isHost ? '<span class="ctag unknown">房主</span>' : ''}`
      : `${identityTags(p, true)}${honorDots(p.honorCount)}`;
    return `
    <div class="pchip ${me ? 'is-you' : ''} ${p.alive === false ? 'dead' : ''}" ${editable ? `data-act="openPerson" data-id="${esc(p.id)}"` : ''}>
      ${avatarHtml(p.avatar, me)}
      <span class="pname ${nameEditable ? 'can-edit' : ''}" ${nameEditable ? 'data-act="editName" title="点一下改昵称"' : ''}>${esc(p.name)}${me ? '（你）' : ''}</span>
      ${tags}
      ${p.connected ? '' : '<span class="ctag unknown">离线</span>'}
      ${lobby && canManage && p.isBot ? `<button class="editbtn" data-act="removeBot" data-id="${esc(p.id)}" title="移除人机">✕</button>` : ''}
      ${editable ? `<button class="editbtn as-icon" data-act="editCamp" data-id="${esc(p.id)}" title="标记他的身份（自己看的笔记）">⚑</button>` : ''}
      ${bubble ? `<span class="pchip-bubble">${esc(bubble)}</span>` : ''}
    </div>`;
  }

  /* ---------------- 大厅 ---------------- */

  function lobbyHtml(view) {
    const players = view.players;
    return `
<div class="screen">
  <div class="lobby">
    <div class="code-box" data-act="openMenu">
      <div class="lbl">房号</div>
      <div class="code">${esc(view.code)}</div>
      <div class="url">其他人打开 ${esc(location.host)} 输入这个房号</div>
    </div>

    <div class="btn-row">
      <button class="btn btn-sm" data-act="copy">复制邀请链接</button>
      <button class="btn btn-sm" data-act="openChat">聊天${chatBadge(view)}</button>
    </div>

    <div class="sect">玩家 ${players.length}/${view.maxPlayers}</div>
    ${view.canHost && players.length < view.maxPlayers
      ? '<button class="btn btn-sm btn-block" data-act="addBot" style="margin-bottom:9px">＋ 添加人机（测试用）</button>'
      : ''}
    <div class="plist">
      ${players.map((p) => playerChip(p, true, view.canHost, true)).join('')}
    </div>

    <div style="flex:1;min-height:8px"></div>

    ${view.canHost
      ? `<button class="btn btn-primary btn-block" data-act="start" ${players.length < view.minPlayers ? 'disabled' : ''}>
           ${players.length < view.minPlayers ? `还差 ${view.minPlayers - players.length} 人才能开始` : '开始游戏'}
         </button>`
      : '<p class="hint">等待房主开始游戏…</p>'}

    <p class="hint">点头像换个配色，点自己的名字改昵称。<br>${view.minPlayers}–${view.maxPlayers} 人开局，先拿到 ${view.winScore} 分的人赢下整局。</p>
  </div>
  ${nameSheet(view)}
  ${campSheet(view)}
  ${chatSheet(view)}
  ${roomSheet(view)}
  ${personSheet(view)}
</div>`;
  }

  /* ---------------- 牌桌 ---------------- */

  const PHASE_LABEL = {
    draft1: '抽牌 · 第一轮',
    draft2: '抽牌 · 第二轮',
    night: '夜晚',
    reveal: '天亮',
    result: '本轮结束',
    gameover: '游戏结束',
    lobby: '大厅',
  };

  function topbar(view) {
    let phase = PHASE_LABEL[view.phase] || view.phase;
    if (view.phase === 'night' && view.summon) phase = `夜晚 · 召唤「${view.summon.name}」`;
    const showTrack = view.phase === 'night';
    return `
<header class="topbar">
  <div class="topline">
    <span class="round">第 ${view.round} 轮</span>
    <span class="phase">${esc(phase)}</span>
    <button class="roomtag" data-act="openMenu">${S.online ? '' : '● '}房号 ${esc(view.code)} ›</button>
  </div>
  ${showTrack ? summonTrack(view) : ''}
</header>`;
  }

  function summonTrack(view) {
    const cur = view.summon ? view.summon.index : -1;
    return `<div class="track">${view.summonOrder.map((n, i) =>
      `<span class="st ${i < cur ? 'done' : ''} ${i === cur ? 'now' : ''}">${esc(n)}</span>`).join('')}</div>`;
  }

  function campName(camp) {
    return camp === 'ronin' ? '浪人' : camp === 'red' ? '红队' : camp === 'blue' ? '蓝队' : '未知';
  }

  function meBlock(view) {
    const you = view.you;
    const camp = you.camp || 'none';
    const rankText = you.camp === 'ronin' ? '中立' : (you.rank || '—');
    const emptyText = ['draft1', 'draft2'].includes(view.phase) ? '选牌中…' : '没有牌了';

    const hand = you.hand.length
      ? you.hand.map((c) => `
        <div class="cardo tone-${c.tone}">
          ${c.num ? `<span class="cnum">${c.num}</span>` : '<span class="cnum passive">被动</span>'}
          <span class="nm">${esc(c.title || c.name)}</span>
          <span class="ds">${esc(c.desc)}</span>
        </div>`).join('')
      : `<div class="cardo is-empty" style="grid-column:1/-1">${emptyText}</div>`;

    return `
<div class="me-wrap">
  <div class="me">
    <div class="camp-card ${camp}">
      <span class="cn">${esc(campName(you.camp))}</span>
      <span class="rk ${you.camp === 'ronin' ? 'sm' : ''}">${esc(String(rankText))}</span>
    </div>
    <div class="me-side">
      <div class="me-stats">
        <span>荣誉 <b>${you.honorCount}</b> 枚</span>
        <span>总分 <b>${you.score}</b></span>
        ${you.alive ? '' : '<span class="none">已出局</span>'}
      </div>
      <div class="hand">${hand}</div>
    </div>
  </div>
</div>`;
  }

  function honorDots(n) {
    if (!n) return '<span class="honor empty" title="还没有荣誉标记">—</span>';
    return `<span class="honor" title="荣誉标记 ${n} 枚（分数只有本人才知道）"><i></i><span class="cnt">${n}</span></span>`;
  }

  function playersBlock(view) {
    return `
<div class="players-wrap">
  <div class="sect">玩家 ${view.players.length}</div>
  <div class="plist">
    ${view.players.map((p) => playerChip(p, false, view.canHost, ['result', 'gameover'].includes(view.phase))).join('')}
  </div>
</div>`;
  }

  function logsBlock(view, wide) {
    return `
<div class="logs-wrap ${wide ? 'logs-wide' : ''}">
  <div class="sect">战况</div>
  <div class="logs">
    ${view.logs.map((l) => `<div class="logline ${l.to ? 'secret' : ''}">${highlightNames(l.text, view)}</div>`).join('')}
  </div>
</div>`;
  }

  function logbar(view) {
    const last = view.logs.length ? view.logs[view.logs.length - 1] : null;
    const chatBtn = `<button class="lb-chat" data-act="openChat">聊天${chatBadge(view)}</button>`;
    if (!last) return `<div class="logbar">${chatBtn}</div>`;
    return `
<div class="logbar">
  <div class="lb-main" data-act="openLogs">
    <span class="lb-dot ${last.to ? 'gold' : ''}"></span>
    <span class="lb-text ${last.to ? 'secret' : ''}">${highlightNames(last.text, view)}</span>
    <span class="lb-more">战况 ›</span>
  </div>
  ${chatBtn}
</div>`;
  }

  function quickPhrases(view) {
    const you = view.you || {};
    const out = [];
    if (you.campLabel) out.push('我是' + you.campLabel);

    // 自己查到的身份：一条一个，直接能说出去
    const known = (view.players || []).filter((p) => p.isIntel && p.campLabel && !p.isYou);
    known.slice(0, 3).forEach((p) => out.push(p.name + '是' + p.campLabel));

    const hand = you.hand || [];
    hand.slice(0, 2).forEach((card) => out.push('我有' + card.title));
    if (!hand.length) out.push('我没牌了');
    out.push('我查过他了', '相信我', '别杀我');
    return out.slice(0, 9);
  }

  function trackBubbles(view) {
    const msgs = view.messages || [];
    const seen = S.seenMsgId || 0;
    let max = seen;
    for (const m of msgs) {
      if (m.id <= seen) continue;
      S.bubbles[m.from] = { text: m.text };
      if (m.id > max) max = m.id;
    }
    if (max > seen) S.seenMsgId = max;
  }

  function liveBubble(playerId) {
    const b = S.bubbles[playerId];
    return b ? b.text : '';
  }

  function chatBubbleHtml() {
    const b = S.chatBubble;
    if (!b) return '';
    const av = b.avatar || { ch: '?', color: '#3a4f63' };
    return `
  <div class="chat-bubble-row" data-act="openChat" title="点开聊天">
    <span class="avatar" style="--av:${esc(av.color)}">${esc(av.ch)}</span>
    <span class="cb-name">${esc(b.name)}</span>
    <span class="cb-text">${esc(b.text)}</span>
  </div>`;
  }

  function handleChatBubble(view) {
    if (S.chatOpen) return;
    const msgs = view.messages || [];
    if (!msgs.length) return;
    const last = msgs[msgs.length - 1];
    if (last.id <= (S.lastBubbleId || 0)) return;
    S.lastBubbleId = last.id;
    S.chatBubble = last;
    clearTimeout(S.bubbleTimer);
    S.bubbleTimer = setTimeout(() => {
      S.chatBubble = null;
      S.lastJson = '';
      render();
    }, 5200);
  }

  function chatSheet(view) {
    if (!S.chatOpen) return '';
    const msgs = view.messages || [];
    const youId = (view.you && view.you.id) || '';
    const body = msgs.length
      ? msgs.map((m) => `
        <div class="msg ${m.from === youId ? 'me' : ''}">
          ${avatarHtml(m.avatar, false)}
          <div class="msg-main">
            <div class="msg-name">${esc(m.name)}</div>
            <div class="msg-text">${esc(m.text)}</div>
          </div>
        </div>`).join('')
      : '<p class="hint" style="text-align:center;padding:24px 0">还没有人说话，说说你的身份吧</p>';

    return `
<div class="overlay">
  <div class="chat-sheet">
    <div class="ls-head">
      <h2 class="serif">聊天</h2>
      <button class="btn btn-sm" data-act="closeChat">关闭</button>
    </div>
    <div class="chat-body" id="chatBody">${body}</div>
    <div class="chat-quick">
      ${quickPhrases(view).map((q) => `<button class="qchip" data-act="sayNow" data-text="${esc(q)}">${esc(q)}</button>`).join('')}
    </div>
    <div class="chat-input">
      <input class="input" id="chatInput" maxlength="120" placeholder="说点什么…" value="${esc(S.chatDraft)}" autocomplete="off">
      <button class="btn btn-primary" data-act="sendChat">发送</button>
    </div>
  </div>
</div>`;
  }

  function logsSheet(view) {
    if (!S.logsOpen) return '';
    return `
<div class="overlay">
  <div class="log-sheet">
    <div class="ls-head">
      <h2 class="serif">战况</h2>
      <button class="btn btn-sm" data-act="closeLogs">关闭</button>
    </div>
    <div class="ls-body" id="lsBody">
      <div class="logs">
        ${view.logs.map((l) => `<div class="logline ${l.to ? 'secret' : ''}">${highlightNames(l.text, view)}</div>`).join('')}
      </div>
    </div>
  </div>
</div>`;
  }

  function promptHtml(p, view) {
    const items = p.options.filter((o) => o.key !== '__none');
    const none = p.options.find((o) => o.key === '__none');
    let body = '';

    if (p.format === 'players') {
      body = `<div class="opts one opts-scroll">${items.map((o) => {
        const target = (view.players || []).find((x) => x.id === o.key);
        return `
        <button class="opt-player" data-act="answer" data-key="${esc(o.key)}">
          ${avatarHtml(target && target.avatar, false)}
          <span class="op-name">${esc(o.label)}</span>
          ${target ? identityTags(target, false) : (o.desc ? `<span class="sub">${esc(o.desc)}</span>` : '')}
        </button>`;
      }).join('')}</div>`;
    } else if (p.format === 'cards') {
      body = `<div class="opts two opts-scroll">${items.map((o) => `
        <button class="cardo is-opt tone-${o.tone || 'view'}" data-act="answer" data-key="${esc(o.key)}">
          ${o.num ? `<span class="cnum">${o.num}</span>` : '<span class="cnum passive">被动</span>'}
          <span class="nm">${esc(o.title || o.label)}</span>
          <span class="ds">${esc(o.desc)}</span>
        </button>`).join('')}</div>`;
    } else {
      body = `<div class="opts two">${items.map((o) => `
        <button class="btn" data-act="answer" data-key="${esc(o.key)}">
          ${esc(o.label)}
          ${o.desc ? `<br><span style="font-size:11px;color:var(--ink-3)">${esc(o.desc)}</span>` : ''}
        </button>`).join('')}</div>`;
    }

    const ghost = none
      ? `<button class="opt-ghost" data-act="answer" data-key="__none" style="margin-top:7px">${esc(none.label)}</button>`
      : '';

    return `
<div class="prompt">
  <div class="prompt-head">
    <h3>${esc(p.title)}</h3>
    <p>${esc(p.text)}</p>
  </div>
  ${body}${ghost}
</div>`;
  }

  function actionBar(view) {
    if (view.prompt) return promptHtml(view.prompt, view);

    if (['draft1', 'draft2', 'night'].includes(view.phase)) {
      const who = view.waiting.length ? `等待 ${view.waiting.join('、')}` : '等待其他人…';
      return `<div class="waiting"><span class="spinner"></span><span>${esc(who)}</span></div>`;
    }
    if (view.phase === 'reveal') {
      return `<div class="waiting"><span class="spinner"></span><span>天亮了，正在公布身份…</span></div>`;
    }
    if ((view.phase === 'result' || view.phase === 'gameover') && !S.resultOpen) {
      return `<button class="btn btn-block" data-act="openResult">查看本轮结果</button>`;
    }
    return '';
  }

  /* ---------------- 结算 ---------------- */

  function revealCard(r) {
    const av = r.target.avatar || { ch: '?', color: '#3a4f63' };
    let badge;
    if (r.kind === 'honor') {
      const sum = (r.honorMarks || []).reduce((x, y) => x + y, 0);
      badge = `<span class="rv-badge honor">${r.honorCount} 枚 · ${sum} 分</span>`;
    } else {
      badge = `<span class="rv-badge ${r.camp || 'ronin'}">${esc(r.campLabel)}</span>`;
    }
    const extra = r.card
      ? `<span class="rv-hand">有「${esc(r.card.title)}${r.card.num ? ' ' + r.card.num : ''}」</span>`
      : '';
    return `
    <div class="reveal-card">
      ${avatarHtml(av, false)}
      <span class="rv-name">${esc(r.target.name)}</span>
      <span class="rv-skill">${esc(r.skill)}${r.kind === 'honor' ? ' · 荣誉' : ''}</span>
      ${extra}
      ${badge}
    </div>`;
  }

  function revealLayer() {
    if (!S.activeReveals || !S.activeReveals.length) return '';
    return `<div class="reveal-line">${S.activeReveals.map(revealCard).join('')}</div>`;
  }

  function handleReveals(view) {
    const list = view.reveals || [];
    if (!list.length) { S.activeReveals = []; return; }
    const last = S.lastRevealId || 0;
    const fresh = list.filter((r) => r.id > last);
    S.lastRevealId = list[list.length - 1].id;
    if (!fresh.length) return;
    S.activeReveals = [...S.activeReveals, ...fresh].slice(-3);
    clearTimeout(S.revealTimer);
    S.revealTimer = setTimeout(() => {
      S.activeReveals = [];
      S.lastJson = '';
      render();
    }, 3400);
  }

  function resultOverlay(view) {
    const r = view.result;
    if (!r) return '';
    if (!S.resultOpen) return '';

    const rows = r.summary.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).map((p) => {
      const campText = p.camp === 'ronin' ? '浪人' : `${campName(p.camp)}${p.rank || ''}`;
      return `
      <div class="rrow ${p.alive ? '' : 'out'} ${r.champion === p.id ? 'champ' : ''}">
        <div class="rname">
          <span>${esc(p.name)}</span>
          <span class="ctag ${p.camp || 'unknown'}">${esc(campText)}</span>
        </div>
        <div class="rst">
          <span>${p.alive ? '存活' : '出局'}</span>
          <span class="delta ${p.delta ? '' : 'zero'}">${p.delta ? '+' + p.delta : '—'}</span>
          <span class="total">${p.score == null ? '—' : p.score + ' 分'}</span>
        </div>
      </div>`;
    }).join('');

    const isOver = view.phase === 'gameover';
    const champ = r.champion ? r.summary.find((p) => p.id === r.champion) : null;

    return `
<div class="overlay">
  <div class="result-sheet">
    <h2 class="serif">${isOver ? '游戏结束' : `第 ${r.round} 轮结束`}</h2>
    <p class="winner">${esc(r.winnerText)}</p>
    ${champ ? `<div class="err" style="background:rgba(217,180,95,.12);border-color:rgba(217,180,95,.4);color:#f0d79a">🏆 ${esc(champ.name)} 以 ${champ.score} 分赢下整局</div>` : ''}
    <div style="margin-top:12px">${rows}</div>
    <div class="result-actions">
      ${isOver
        ? (view.canHost
            ? `<button class="btn btn-primary btn-block" data-act="restart">再来一局</button>${view.isHost ? '' : '<p class="hint">房主已离线，你暂时可以代为主持</p>'}`
            : '<p class="hint">等待房主开新局…</p>')
        : (view.canHost
            ? `<button class="btn btn-primary btn-block" data-act="next">开始下一轮</button>${view.isHost ? '' : '<p class="hint">房主已离线，你暂时可以代为主持</p>'}`
            : '<p class="hint">等待房主开下一轮…</p>')}
      <button class="btn btn-sm btn-block" data-act="closeResult">收起，看牌桌</button>
    </div>
  </div>
</div>`;
  }

  function nameSheet(view) {
    if (!S.nameOpen) return '';
    const me = view.you || {};
    const avs = metaAvatars();
    const cur = me.avatarIndex;
    const myChar = Array.from(String(me.name || '?').trim())[0] || '?';
    return `
<div class="overlay">
  <div class="name-sheet">
    <h2 class="serif">改个名字</h2>
    <p class="hint">最多 12 个字，房间里不能重名。</p>
    <input class="input" id="renameInput" maxlength="12" value="${esc(S.renameDraft || me.name || '')}" autocomplete="off">
    <div class="sect" style="margin:16px 0 9px">换个配色（字跟着昵称走）</div>
    <div class="avatar-picker">
      ${avs.map((a, i) => `<button class="avatar is-btn ${i === cur ? 'picked' : ''}" data-act="pickAvatar" data-idx="${i}" style="--av:${esc(a.color)}">${esc(myChar)}</button>`).join('')}
    </div>
    <div class="name-actions">
      <button class="btn btn-primary btn-block" data-act="saveName">保存</button>
      <button class="btn btn-block" data-act="closeName">取消</button>
    </div>
  </div>
</div>`;
  }

  /** 点某个玩家，给他贴个自己的记号，怕忘了谁被查出来过 */
  function roomSheet(view) {
    if (!S.menuOpen) return '';
    const inGame = !['lobby', 'result', 'gameover'].includes(view.phase);
    return `
<div class="overlay">
  <div class="name-sheet">
    <h2 class="serif">房间 ${esc(view.code)}</h2>
    <p class="hint">${inGame ? '这一轮还没打完。想换人的话，房主可以直接结束本局回到大厅。' : '人齐了就开局，走的人可以随时退。'}</p>
    <div class="name-actions">
      <button class="btn btn-block" data-act="copy">复制邀请链接</button>
      ${view.canHost && inGame ? '<button class="btn btn-primary btn-block" data-act="endGame">结束本局，回到大厅</button>' : ''}
      <button class="btn btn-block" data-act="leaveRoom">退出房间</button>
      <button class="btn btn-block" data-act="closeMenu">取消</button>
    </div>
  </div>
</div>`;
  }

  /** 这个人的身份候选：你查到的排第一，其次是自己标记的，其余按红蓝顺序 */
  function identityOptions(view, target) {
    const half = Math.max(2, Math.ceil(((view.players || []).length) / 2));
    const all = [];
    for (let r = 1; r <= half; r++) all.push({ camp: 'red', rank: r, label: '红队' + r });
    for (let r = 1; r <= half; r++) all.push({ camp: 'blue', rank: r, label: '蓝队' + r });
    all.push({ camp: 'ronin', rank: '', label: '浪人' });
    const known = target.isIntel ? target.campLabel : null;
    const note = target.noteLabel;
    const scoreOf = (o) => (o.label === known ? 0 : (o.label === note ? 1 : 2));
    return all
      .map((o, i) => ({ ...o, order: i, score: scoreOf(o) }))
      .sort((a, b) => (a.score - b.score) || (a.order - b.order))
      .map((o) => ({
        ...o,
        hint: o.label === known ? '查' : (o.label === note ? '记' : ''),
        best: o.label === known || (!known && o.label === note),
      }));
  }

  function personSheet(view) {
    if (!S.personTarget) return '';
    const target = (view.players || []).find((p) => p.id === S.personTarget);
    if (!target) return '';
    const said = (view.messages || []).filter((m) => m.from === target.id).slice(-5);
    const list = said.length
      ? said.map((m) => `<div class="pd-line">${esc(m.text)}</div>`).join('')
      : '<div class="pd-line muted">还没说过话</div>';
    const opts = identityOptions(view, target);

    return `
<div class="overlay">
  <div class="name-sheet sheet-wide">
    <div class="pd-head">
      ${avatarHtml(target.avatar, false)}
      <div class="pd-name">${esc(target.name)}</div>
      ${target.campLabel ? `<span class="ctag ${target.campKey || 'unknown'} ${target.isIntel ? 'intel' : ''}">${esc(target.campLabel)}</span>` : ''}
      ${target.noteLabel ? `<span class="ctag ${target.noteCamp || 'unknown'} note">记 ${esc(target.noteLabel)}</span>` : ''}
      <span class="pd-honor" title="荣誉标记数量是公开的，具体分数只有本人才知道">荣誉 ${target.honorCount || 0} 枚</span>
    </div>

    <div class="pd-body">
      <div class="pd-col">
        <div class="sect" style="margin:0 0 8px">他说过的话</div>
        <div class="pd-log">${list}</div>
      </div>
      <div class="pd-col">
        <div class="sect" style="margin:0 0 8px">发一句：他是…</div>
        <div class="opts two opts-scroll" style="max-height:26dvh">
          ${opts.map((o) => `<button class="btn ${o.best ? 'picked' : ''}" data-act="sayIdentity"
            data-target="${esc(target.id)}" data-camp="${o.camp}" data-rank="${o.rank}"
            data-label="${esc(o.label)}">他是${esc(o.label)}${o.hint ? ` <em>${o.hint}</em>` : ''}</button>`).join('')}
        </div>

        <div class="sect" style="margin:14px 0 8px">只给自己记（想改就再点一次）</div>
        <div class="opts two opts-scroll" style="max-height:24dvh">
          ${opts.map((o) => `<button class="btn ${target.noteLabel === o.label ? 'picked' : ''}" data-act="setNote"
            data-target="${esc(target.id)}" data-camp="${o.camp}" data-rank="${o.rank}">记 ${esc(o.label)}</button>`).join('')}
        </div>
      </div>
    </div>

    <div class="name-actions">
      ${target.noteLabel ? '<button class="btn btn-block" data-act="setNote" data-target="' + esc(target.id) + '" data-camp="" data-rank="">清除标记</button>' : ''}
      <button class="btn btn-block" data-act="closePerson">关闭</button>
    </div>
  </div>
</div>`;
  }

  function campSheet(view) {
    if (!S.editTarget) return '';
    const target = (view.players || []).find((p) => p.id === S.editTarget);
    if (!target) return '';
    const maxRank = Math.max(2, Math.ceil((view.players || []).length / 2));
    const opts = [];
    for (let r = 1; r <= maxRank; r++) opts.push({ camp: 'red', rank: r, label: `红队${r}` });
    for (let r = 1; r <= maxRank; r++) opts.push({ camp: 'blue', rank: r, label: `蓝队${r}` });
    opts.push({ camp: 'ronin', rank: '', label: '浪人' });
    return `
<div class="overlay">
  <div class="name-sheet">
    <h2 class="serif">标记 ${esc(target.name)}</h2>
    <p class="hint">只是你自己的笔记，会和真实身份分开显示。想改就再点一次，随时能换。</p>
    <div class="opts two opts-scroll" style="max-height:48dvh">
      ${opts.map((o) => `<button class="btn ${target.noteLabel === o.label ? 'picked' : ''}" data-act="setNote" data-target="${esc(target.id)}" data-camp="${o.camp}" data-rank="${o.rank}">${esc(o.label)}</button>`).join('')}
    </div>
    <div class="name-actions">
      <button class="btn btn-block" data-act="setNote" data-target="${esc(target.id)}" data-camp="" data-rank="">清除标记</button>
      <button class="btn btn-block" data-act="closeCamp">取消</button>
    </div>
  </div>
</div>`;
  }

  /** 其他人按上 / 左 / 右三面围桌，自己在下方 */
  function ringLayout(view) {
    const others = (view.players || []).filter((p) => !p.isYou);
    const n = others.length;
    const canRename = ['result', 'gameover'].includes(view.phase);
    const chip = (p) => playerChip(p, false, view.canHost, canRename);
    if (!n) return { top: '', left: '', right: '' };
    let topCount;
    if (n <= 2) topCount = n;
    else if (n <= 4) topCount = Math.ceil(n / 2);
    else topCount = Math.min(4, Math.ceil(n * 0.45));
    const rest = n - topCount;
    const leftCount = Math.ceil(rest / 2);
    return {
      top: others.slice(0, topCount).map(chip).join(''),
      left: others.slice(topCount, topCount + leftCount).map(chip).join(''),
      right: others.slice(topCount + leftCount).map(chip).join(''),
    };
  }

  function boardInfo(view) {
    const label = PHASE_LABEL[view.phase] || view.phase;
    const summonName = view.summon ? view.summon.name : '';
    const waiting = (view.waiting || []).filter(Boolean);
    return `
<div class="board-ring">
  <div class="board-inner">
    <div class="board-tag">${esc(summonName ? '召唤「' + summonName + '」' : label)}</div>
    ${view.summon ? summonTrack(view) : ''}
    <div class="board-note">${esc(waiting.length ? '等待 ' + waiting.join('、') : (summonName ? '持有者同时决定' : ''))}</div>
  </div>
</div>`;
  }

  function gameHtml(view) {
    const ring = ringLayout(view);
    return `
<div class="screen">
  ${topbar(view)}
  ${revealLayer() || logbar(view)}
  <main class="scroll">
    <section class="table">
      <div class="ring ring-top">${ring.top}</div>
      <div class="ring ring-left">${ring.left}</div>
      <div class="board">${boardInfo(view)}</div>
      <div class="ring ring-right">${ring.right}</div>
      <div class="col-center">${meBlock(view)}</div>
    </section>
    ${logsBlock(view, true)}
  </main>
  <footer class="actionbar">${actionBar(view)}</footer>
  <div class="my-dock">${meBlock(view)}</div>
  ${logsSheet(view)}
  ${resultOverlay(view)}
  ${nameSheet(view)}
  ${campSheet(view)}
  ${chatSheet(view)}
  ${roomSheet(view)}
  ${personSheet(view)}
</div>`;
  }

  /* ---------------- 交互 ---------------- */

  async function doAction(body, el) {
    if (S.submitting) return;
    S.submitting = true;
    if (el) { el.disabled = true; el.style.opacity = '.55'; }
    try {
      await post('/api/action', { code: S.code, token: S.token, ...body });
    } catch (err) {
      toast(err.message);
      if (el) { el.disabled = false; el.style.opacity = ''; }
    } finally {
      S.submitting = false;
    }
  }

  async function submitRename(name) {
    if (S.submitting) return;
    S.submitting = true;
    try {
      await post('/api/action', { code: S.code, token: S.token, action: 'rename', name });
      S.name = name;
      localStorage.setItem('rz.name', name);
      S.nameOpen = false;
      S.lastJson = '';
      render();
      toast('名字已更新');
    } catch (err) {
      toast(err.message);
    } finally {
      S.submitting = false;
    }
  }

  function leaveToHome() {
    if (es) { es.close(); es = null; }
    clearTimeout(S.revealTimer);
    clearTimeout(S.bubbleTimer);
    localStorage.removeItem('rz.token');
    localStorage.removeItem('rz.code');
    S.view = null;
    S.code = '';
    S.token = '';
    S.menuOpen = false;
    S.nameOpen = false;
    S.editTarget = null;
    S.chatOpen = false;
    S.logsOpen = false;
    S.activeReveals = [];
    S.chatBubble = null;
    S.lastRound = -1;
    S.lastMsgId = 0;
    S.lastBubbleId = 0;
    S.lastRevealId = 0;
    S.joinCode = '';
    S.error = '';
    S.lastJson = '';
    history.replaceState(null, '', location.pathname);
    render();
    toast('已退出房间');
  }

  async function leaveRoom() {
    if (S.submitting) return;
    S.submitting = true;
    try {
      await post('/api/action', { code: S.code, token: S.token, action: 'leave' });
      leaveToHome();
    } catch (err) {
      toast(err.message);
    } finally {
      S.submitting = false;
    }
  }

  async function createRoom() {
    const name = ($('#nameInput') || {}).value || '';
    if (!name.trim()) { S.error = '先填一个名字吧'; render(); S.lastJson=''; return; }
    S.name = name.trim();
    localStorage.setItem('rz.name', S.name);
    try {
      const r = await post('/api/create', { name: S.name, avatar: S.avatar });
      S.code = r.code; S.token = r.token; S.error = '';
      startStream();
    } catch (err) { S.error = err.message; S.lastJson = ''; render(); }
  }

  async function joinRoom() {
    const name = ($('#nameInput') || {}).value || '';
    const code = (($('#codeInput') || {}).value || '').trim().toUpperCase();
    if (!name.trim()) { S.error = '先填一个名字吧'; S.lastJson = ''; render(); return; }
    if (code.length < 4) { S.error = '房号是 4 位'; S.lastJson = ''; render(); return; }
    S.name = name.trim();
    S.joinCode = code;
    localStorage.setItem('rz.name', S.name);
    try {
      const r = await post('/api/join', { code, name: S.name, avatar: S.avatar });
      S.code = r.code; S.token = r.token; S.error = ''; S.joinCode = '';
      startStream();
    } catch (err) { S.error = err.message; S.lastJson = ''; render(); }
  }

  function copyInvite() {
    const url = `${location.origin}/?r=${S.code}`;
    const done = () => toast('邀请链接已复制');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => manualCopy(url, done));
    } else manualCopy(url, done);
  }

  function manualCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { toast(`手动分享：${text}`); }
    ta.remove();
  }

  $('#app').addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;

    if (act === 'cycleAvatar') {
      const len = metaAvatars().length;
      S.avatar = (S.avatar + 1) % len;
      localStorage.setItem('rz.avatar', String(S.avatar));
      render();
      return;
    }
    if (act === 'addBot') return void doAction({ action: 'addBot' }, el);
    if (act === 'removeBot') return void doAction({ action: 'removeBot', target: el.dataset.id }, el);
    if (act === 'create') return void createRoom();
    if (act === 'join') return void joinRoom();
    if (act === 'copy') return void copyInvite();
    if (act === 'answer') return void doAction({ action: 'answer', key: el.dataset.key }, el);
    if (act === 'start') return void doAction({ action: 'start' }, el);
    if (act === 'next') return void doAction({ action: 'next' }, el);
    if (act === 'restart') return void doAction({ action: 'restart' }, el);
    if (act === 'openResult') { S.resultOpen = true; S.lastJson = ''; render(); return; }
    if (act === 'closeResult') { S.resultOpen = false; S.lastJson = ''; render(); return; }
    if (act === 'editName') {
      S.nameOpen = true;
      S.renameDraft = (S.view && S.view.you && S.view.you.name) || S.name;
      S.lastJson = '';
      render();
      setTimeout(() => { const el = $('#renameInput'); if (el) { el.focus(); el.select(); } }, 60);
      return;
    }
    if (act === 'closeName') { S.nameOpen = false; S.lastJson = ''; render(); return; }
    if (act === 'pickAvatar') {
      const idx = Number(el.dataset.idx);
      S.avatar = idx;
      localStorage.setItem('rz.avatar', String(idx));
      void doAction({ action: 'setAvatar', avatar: idx }, el);
      return;
    }
    if (act === 'openPerson') {
      S.personTarget = el.dataset.id;
      S.editTarget = null;
      S.lastJson = '';
      render();
      return;
    }
    if (act === 'closePerson') { S.personTarget = null; S.lastJson = ''; render(); return; }
    if (act === 'sayIdentity') {
      const t = (S.view.players || []).find((p) => p.id === el.dataset.target);
      const label = el.dataset.label || '';
      if (!t || !label) return;
      S.personTarget = null;
      S.lastJson = '';
      render();
      void doAction({ action: 'say', text: t.name + '是' + label });
      return;
    }
    if (act === 'editCamp') { S.editTarget = el.dataset.id; S.personTarget = null; S.lastJson = ''; render(); return; }
    if (act === 'closeCamp') { S.editTarget = null; S.lastJson = ''; render(); return; }
    if (act === 'setNote') {
      S.editTarget = null;
      S.personTarget = null;
      S.lastJson = '';
      void doAction({ action: 'setNote', target: el.dataset.target, camp: el.dataset.camp, rank: el.dataset.rank || null }, el);
      return;
    }
    if (act === 'saveName') {
      const input = $('#renameInput');
      const val = input ? input.value.trim() : '';
      if (!val) { toast('名字不能为空'); return; }
      void submitRename(val);
      return;
    }
    if (act === 'nextAvatar') { void doAction({ action: 'avatar' }); return; }
    if (act === 'openMenu') { S.menuOpen = true; S.lastJson = ''; render(); return; }
    if (act === 'closeMenu') { S.menuOpen = false; S.lastJson = ''; render(); return; }
    if (act === 'endGame') {
      S.menuOpen = false;
      S.lastJson = '';
      void doAction({ action: 'restart' });
      return;
    }
    if (act === 'leaveRoom') { void leaveRoom(); return; }
    if (act === 'openChat') {
      S.chatOpen = true;
      S.lastJson = '';
      render();
      setTimeout(() => { const el = $('#chatInput'); if (el) el.focus(); }, 80);
      return;
    }
    if (act === 'closeChat') { S.chatOpen = false; S.lastJson = ''; render(); return; }
    if (act === 'sendChat') {
      const input = $('#chatInput');
      const text = ((input ? input.value : S.chatDraft) || '').trim();
      if (!text) return;
      S.chatDraft = '';
      if (input) input.value = '';
      void doAction({ action: 'say', text });
      return;
    }
    if (act === 'sayNow') {
      const text = el.dataset.text || '';
      if (!text) return;
      void doAction({ action: 'say', text });
      return;
    }
    if (act === 'openLogs') { S.logsOpen = true; S.lastJson = ''; render(); return; }
    if (act === 'closeLogs') { S.logsOpen = false; S.lastJson = ''; render(); return; }
  });

  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'renameInput') S.renameDraft = e.target.value;
    if (e.target && e.target.id === 'chatInput') S.chatDraft = e.target.value;
    if (e.target && e.target.id === 'nameInput') {
      S.name = e.target.value;
      const el = document.querySelector('.avatar-lg');
      if (el) el.textContent = homeChar();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && S.chatOpen && document.activeElement && document.activeElement.id === 'chatInput') {
      e.preventDefault();
      const input = $('#chatInput');
      const text = (input ? input.value : '').trim();
      if (text) { S.chatDraft = ''; if (input) input.value = ''; void doAction({ action: 'say', text }); }
      return;
    }
    if (e.key === 'Enter' && S.nameOpen) {
      const input = $('#renameInput');
      if (input && input.value.trim()) { void submitRename(input.value.trim()); }
      return;
    }
    if (e.key === 'Enter' && !S.view) {
      const active = document.activeElement;
      if (active && active.id === 'codeInput') joinRoom();
      else if (active && active.id === 'nameInput') {
        const code = (($('#codeInput') || {}).value || '').trim();
        code.length >= 4 ? joinRoom() : createRoom();
      }
    }
  });

  boot();
})();
