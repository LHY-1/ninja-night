'use strict';

/* ==========================================================
 * 《忍者之夜》规则引擎
 * 纯逻辑，不碰网络。server.js 通过 room.onUpdate 驱动推送。
 * ========================================================== */

const SUMMON_ORDER = ['scout', 'hermit', 'trickster', 'assassin', 'jonin'];
const KIND_INDEX = {};
SUMMON_ORDER.forEach((k, i) => { KIND_INDEX[k] = i; });

const ACTIVE_META = {
  scout: { name: '密探' },
  hermit: { name: '隐士' },
  trickster: { name: '骗徒' },
  assassin: { name: '刺客' },
  jonin: { name: '上忍' },
};

const PASSIVE_META = {
  martyr: { name: '殉道者' },
  reflector: { name: '反杀' },
  mastermind: { name: '大将军' },
};

const PASSIVE_DESC = {
  martyr: '当他人击杀你时，翻开此牌：你出局，但获得 1 个荣誉标记。',
  reflector: '当他人击杀你时，翻开此牌：反杀对方，你存活下来。',
  mastermind: '若你持有此牌活到最后，你的阵营赢得本轮胜利（若你是浪人则你单独获胜）。',
};

const TRICKSTER_META = {
  1: { name: '百变者', desc: '查看两名其他玩家的阵营牌，之后你可以选择是否交换他们。' },
  2: { name: '掘墓人', desc: '查看弃牌堆的两张忍者牌，取走其中一张。可立刻使用，也可留到对应召唤阶段。' },
  3: { name: '捣蛋鬼', desc: '查看一名其他玩家的阵营牌，并可将其公开。' },
  4: { name: '灵魂商贩', desc: '查看一名其他玩家的荣誉标记或阵营牌，并可与该玩家交换一个荣誉标记。' },
  5: { name: '窃贼', desc: '揭示你的阵营牌，并从荣誉标记比你多的一位玩家那里拿走一个标记。' },
  6: { name: '裁判', desc: '揭示你的阵营牌，并击杀一名玩家。此击杀不受「反杀」或「殉道者」影响。' },
};

const CAMP_NAME = { red: '红队', blue: '蓝队', ronin: '浪人' };

/** 每人自动分到一枚家纹印章：一个汉字 + 一种低饱和色。最多 11 人，12 枚足够不重复。 */
const AVATARS = [
  { ch: '忍', color: '#8d2f28' },
  { ch: '影', color: '#3a4f63' },
  { ch: '月', color: '#4a5b8a' },
  { ch: '风', color: '#2f6b52' },
  { ch: '雷', color: '#8a5a2b' },
  { ch: '火', color: '#b04a2a' },
  { ch: '水', color: '#2c5c92' },
  { ch: '刃', color: '#6b4450' },
  { ch: '朧', color: '#5b3a80' },
  { ch: '霞', color: '#7a4a6a' },
  { ch: '淵', color: '#274a5e' },
  { ch: '楓', color: '#7a3b32' },
];

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 11;
const WIN_SCORE = 10;

function cardName(c) {
  if (c.kind === 'trickster') return `骗徒 ${c.num} · ${TRICKSTER_META[c.num].name}`;
  if (c.kind === 'martyr' || c.kind === 'reflector' || c.kind === 'mastermind') return PASSIVE_META[c.kind].name;
  return `${ACTIVE_META[c.kind].name} ${c.num}`;
}

function cardDesc(c) {
  switch (c.kind) {
    case 'scout': return '查看一名其他玩家的阵营牌。';
    case 'hermit': return '查看一名其他玩家的阵营牌，以及他的一张忍者牌。';
    case 'assassin': return '击杀一名其他玩家。';
    case 'jonin': return '查看一位玩家的阵营牌，然后选择是否击杀他。';
    case 'trickster': return TRICKSTER_META[c.num].desc;
    default: return PASSIVE_DESC[c.kind] || '';
  }
}

function cardKindLabel(c) {
  if (c.kind === 'trickster') return `骗徒${c.num}`;
  if (PASSIVE_META[c.kind]) return PASSIVE_META[c.kind].name;
  return `${ACTIVE_META[c.kind].name}${c.num}`;
}

/** 卡的视觉分类：view=查看 kill=击杀 trick=骗徒 passive=被动 */
function toneOf(c) {
  if (PASSIVE_META[c.kind]) return 'passive';
  if (c.kind === 'trickster') return 'trick';
  if (c.kind === 'assassin') return 'kill';
  return 'view';
}

/** 牌面标题：密探 / 百变者 / 殉道者 —— 编号单独做角标 */
function cardTitle(c) {
  if (c.kind === 'trickster') return TRICKSTER_META[c.num].name;
  if (PASSIVE_META[c.kind]) return PASSIVE_META[c.kind].name;
  return ACTIVE_META[c.kind].name;
}

function cardOption(c) {
  return {
    key: c.id, label: cardName(c), title: cardTitle(c), num: c.num,
    desc: cardDesc(c), tone: toneOf(c), kindLabel: cardKindLabel(c),
  };
}

/** 头像 = 昵称的第一个字 + 自动分配的配色。改昵称，头像的字跟着变。 */
function avatarOf(p) {
  const av = AVATARS[p.avatar] || AVATARS[0];
  const chars = Array.from(String(p.name || '').trim());
  return { ch: chars.length ? chars[0].toUpperCase() : av.ch, color: av.color };
}

function campLabel(p) {
  if (!p.camp) return '未知';
  if (p.camp === 'ronin') return '浪人';
  return `${CAMP_NAME[p.camp]}${p.rank}`;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDeck() {
  const deck = [
    { id: 'martyr#0', kind: 'martyr', num: 0 },
    { id: 'reflector#0', kind: 'reflector', num: 0 },
    { id: 'mastermind#0', kind: 'mastermind', num: 0 },
  ];
  for (const kind of SUMMON_ORDER) {
    for (let n = 1; n <= 6; n++) deck.push({ id: `${kind}#${n}`, kind, num: n });
  }
  return deck; // 33 张
}

/**
 * 存活者地位比较：按位次升序做字典序比较，缺位视为无穷大（最末位）。
 * 返回 >0 表示 a 方地位更高，<0 表示 b 方更高，0 表示相等。
 *   红2 > 蓝3+蓝4  /  红1+红3 < 蓝1+蓝2  /  红2+红4 > 蓝2  /  红2+红3 = 蓝2+蓝3
 */
function compareRanks(a, b) {
  const A = a.slice().sort((x, y) => x - y);
  const B = b.slice().sort((x, y) => x - y);
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const x = A[i] === undefined ? Infinity : A[i];
    const y = B[i] === undefined ? Infinity : B[i];
    if (x < y) return 1;
    if (x > y) return -1;
  }
  return 0;
}

/* ============================ 房间 ============================ */

class Room {
  constructor(code) {
    this.code = code;
    this.players = [];
    this.hostId = null;
    this.listeners = new Set();
    this.createdAt = Date.now();
    this.game = new Game(this);
  }

  onUpdate(fn) { this.listeners.add(fn); }
  offUpdate(fn) { this.listeners.delete(fn); }
  broadcast() {
    for (const fn of [...this.listeners]) {
      try { fn(); } catch (e) { /* 单个连接失败不影响其他人 */ }
    }
  }

  byToken(token) { return this.players.find(p => p.token === token); }
  byId(id) { return this.players.find(p => p.id === id); }

  addPlayer(name, token, avatarWanted, isBot) {
    if (this.players.length >= MAX_PLAYERS) throw new Error(`房间已满（最多 ${MAX_PLAYERS} 人）`);
    const clean = String(name || '').trim().slice(0, 12) || `玩家${this.players.length + 1}`;
    if (this.players.some((p) => p.name === clean)) {
      throw new Error('这个名字有人用了，换一个吧');
    }
    const taken = new Set(this.players.map((p) => p.avatar));
    const wanted = Number.isInteger(avatarWanted) && avatarWanted >= 0 && avatarWanted < AVATARS.length
      ? avatarWanted : null;
    let avatar;
    if (wanted !== null && !taken.has(wanted)) {
      avatar = wanted;
    } else {
      const freeAvatars = AVATARS.map((_, i) => i).filter((i) => !taken.has(i));
      avatar = freeAvatars.length
        ? freeAvatars[Math.floor(Math.random() * freeAvatars.length)]
        : Math.floor(Math.random() * AVATARS.length);
    }
    const player = {
      id: 'p' + Math.random().toString(36).slice(2, 9),
      name: clean,
      token,
      seat: this.players.length,
      connected: true,
      isBot: !!isBot,
      avatar,
      intel: {},
      notes: {},
      alive: true,
      camp: null,
      rank: null,
      revealed: false,
      hand: [],
      draft: [],
      honor: [],
      score: 0,
    };
    this.players.push(player);
    if (!this.hostId) this.hostId = player.id;
    this.game.log(`${clean} 加入了房间${isBot ? '（人机）' : ''}。`);
    return player;
  }

  addBot() {
    let n = 1;
    while (this.players.some((p) => p.name === `人机${n}`)) n++;
    return this.addPlayer(`人机${n}`, 'bot' + Math.random().toString(36).slice(2, 9), null, true);
  }

  removePlayer(playerId) {
    const p = this.byId(playerId);
    if (!p) return { error: '找不到这名玩家' };
    this.players = this.players.filter((x) => x.id !== playerId);
    this.players.forEach((x, i) => { x.seat = i; });
    if (this.hostId === playerId) {
      this.hostId = this.players.length ? this.players[0].id : null;
      if (this.hostId) this.game.log('房主离开了，房主权限已交给 ' + this.byId(this.hostId).name + '。');
    }
    this.game.log(`${p.name} 离开了房间。`);
    this.broadcast();
    return { ok: true };
  }

  removeBot(playerId) {
    const p = this.byId(playerId);
    if (!p || !p.isBot) return { error: '只能移除人机' };
    this.players = this.players.filter((x) => x.id !== playerId);
    this.players.forEach((x, i) => { x.seat = i; });
    if (this.hostId === playerId) this.hostId = this.players.length ? this.players[0].id : null;
    this.game.log(`${p.name} 被移出房间。`);
    this.broadcast();
    return { ok: true };
  }

  get ordered() { return [...this.players].sort((a, b) => a.seat - b.seat); }
}

/* ============================ 游戏 ============================ */

class Game {
  constructor(room) {
    this.room = room;
    this.round = 0;
    this.phase = 'lobby';
    this.logs = [];
    this.logSeq = 0;
    this.pendings = new Map();
    this.result = null;
    this.summonKind = null;
    this.summonIndex = -1;
    this.discardPile = [];
    this.honorPool = [];
    this.reveals = [];
    this.revealSeq = 0;
    this.messages = [];
    this.msgSeq = 0;
    this.aborted = false;
    this.fillHonorPool();
    this.busy = false;
  }

  /* ---------- 基础设施 ---------- */

  touch() { this.#expireOffline(); this.room.broadcast(); }

  log(text, to) {
    if (this.aborted) return;
    this.logs.push({ id: ++this.logSeq, text, to: to || null, round: this.round });
    if (this.logs.length > 400) this.logs.splice(0, 100);
    this.touch();
  }

  priv(player, text) { this.log(text, player.id); }

  fillHonorPool() {
    const pool = [];
    for (let i = 0; i < 20; i++) pool.push(2);
    for (let i = 0; i < 10; i++) pool.push(3);
    for (let i = 0; i < 5; i++) pool.push(4);
    shuffle(pool);
    this.honorPool = pool;
  }

  grantHonor(player, reason) {
    if (!this.honorPool.length) {
      this.fillHonorPool();
      this.log('荣誉标记已抽完，重新补齐一套。');
    }
    const value = this.honorPool.pop();
    player.honor.push(value);
    player.score += value;
    return value;
  }

  ask(playerId, q) {
    return new Promise((resolve) => {
      const p = this.room.byId(playerId);
      if (!p) { resolve(q.options[q.options.length - 1].key); return; }
      const fallKey = q.defaultKey || q.options[q.options.length - 1].key;
      if (this.aborted) { resolve(fallKey); return; }
      if (p.isBot) {
        if (this.aborted) { resolve(this.#botChoice(q)); return; }
        setTimeout(() => resolve(this.#botChoice(q)), 450 + Math.random() * 650);
        return;
      }
      const defaultKey = q.defaultKey || q.options[q.options.length - 1].key;
      const timeoutMs = q.timeoutMs || 180000;
      const timer = setTimeout(() => {
        if (!this.pendings.has(playerId)) return;
        this.pendings.delete(playerId);
        this.log(`⏱ ${p.name} 超时未操作，自动跳过。`);
        resolve(defaultKey);
      }, timeoutMs);
      this.pendings.set(playerId, {
        q,
        defaultKey,
        offlineSince: p.connected ? 0 : Date.now(),
        resolve: (key) => { clearTimeout(timer); resolve(key); },
      });
      this.touch();
    });
  }

  /** 人机的选择：够用来测试，也不会做出太离谱的动作 */
  #botChoice(q) {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const opts = q.options;
    const none = opts.find((o) => o.key === '__none');

    // 挑荣誉标记：人机给最小的，拿最大的
    if (q.botPick === 'min' || q.botPick === 'max') {
      const scored = opts
        .filter((o) => o.key !== '__none')
        .map((o) => ({ o, v: parseFloat(o.label) || 0 }));
      if (scored.length) {
        scored.sort((a, b) => a.v - b.v);
        return (q.botPick === 'max' ? scored[scored.length - 1] : scored[0]).o.key;
      }
    }

    // 被击杀时的被动牌：一定发动
    const passives = opts.filter((o) => o.tone === 'passive');
    if (passives.length && q.title.indexOf('被击杀') >= 0) return pick(passives).key;

    const cards = opts.filter((o) => o.tone && o.key !== '__none');
    if (none) {
      // 召唤阶段：有牌的时候大概率用掉
      if (cards.length && Math.random() < 0.75) return pick(cards).key;
      return '__none';
    }
    if (cards.length) return pick(cards).key;

    const choices = opts.filter((o) => o.key !== '__none');
    if (choices.length) return pick(choices).key;
    return opts[opts.length - 1].key;
  }

  /** 玩家掉线后不久就自动跳过，避免全场干等三分钟 */
  #expireOffline() {
    if (!this.pendings.size) return;
    const now = Date.now();
    for (const [pid, pending] of [...this.pendings.entries()]) {
      const p = this.room.byId(pid);
      if (p && p.connected) { pending.offlineSince = 0; continue; }
      if (!pending.offlineSince) { pending.offlineSince = now; continue; }
      if (now - pending.offlineSince < 20000) continue;
      this.pendings.delete(pid);
      this.log(`⏱ ${p ? p.name : '玩家'} 掉线超过 20 秒，自动跳过。`);
      pending.resolve(pending.defaultKey);
    }
  }

  /** 房主在线时只能房主操作；房主掉线则放行给任何人，避免整局卡死 */
  #hostIsAway() {
    const host = this.room.byId(this.room.hostId);
    return !host || !host.connected;
  }

  #hostCheck(playerId) {
    if (playerId === this.room.hostId) return null;
    if (this.#hostIsAway()) return null;
    return { error: '只有房主可以操作' };
  }

  submit(playerId, key) {
    const pending = this.pendings.get(playerId);
    if (!pending) return { error: '现在没有轮到你操作' };
    const valid = pending.q.options.some(o => o.key === key);
    if (!valid) return { error: '无效的选项' };
    this.pendings.delete(playerId);
    pending.resolve(key);
    this.touch();
    return { ok: true };
  }

  hasPending(playerId) { return this.pendings.has(playerId); }

  /* ---------- 房间 / 流程控制 ---------- */

  rename(playerId, name) {
    const p = this.room.byId(playerId);
    if (!p) return { error: '你不在这个房间里' };
    if (!['lobby', 'result', 'gameover'].includes(this.phase)) {
      return { error: '这一轮正在打，等本轮结束再改名字吧' };
    }
    const clean = String(name || '').trim().slice(0, 12);
    if (!clean) return { error: '名字不能为空' };
    if (clean === p.name) return { ok: true };
    if (this.room.players.some((x) => x.id !== p.id && x.name === clean)) {
      return { error: '这个名字已经有人用了' };
    }
    const old = p.name;
    p.name = clean;
    this.log(`${old} 改名为 ${clean}。`);
    return { ok: true };
  }

  setAvatar(playerId, idx) {
    const p = this.room.byId(playerId);
    if (!p) return { error: '你不在这个房间里' };
    const i = Number(idx);
    if (!Number.isInteger(i) || i < 0 || i >= AVATARS.length) return { error: '无效的头像' };
    const taken = new Set(this.room.players.filter((x) => x.id !== p.id).map((x) => x.avatar));
    if (taken.has(i)) return { error: '这枚头像已经有人用了' };
    p.avatar = i;
    this.touch();
    return { ok: true };
  }

  #sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /** 人机随口说一句：拿自己的身份/手牌/口头禅当素材 */
  #botSay(bot) {
    if (!bot || !bot.alive) return;
    const lines = [];
    if (bot.camp) lines.push('我是' + campLabel(bot));
    bot.hand.forEach((c) => lines.push('我有' + cardTitle(c)));
    lines.push('相信我', '别杀我', '我查过他了', '这轮听我的');
    const text = lines[Math.floor(Math.random() * lines.length)];
    try { this.say(bot.id, text); } catch (err) { /* 说太快就跳过 */ }
  }

  /** 让若干人机分头插话，不阻塞白天黑夜的流程 */
  #botChatter(chance) {
    const bots = this.room.players.filter((p) => p.isBot && p.alive);
    for (const b of bots) {
      if (Math.random() > (chance || 0.75)) continue;
      setTimeout(() => this.#botSay(b), 200 + Math.random() * 1400);
    }
  }

  /** 发言：全桌可见，存快照所以改名后旧消息不变 */
  say(playerId, text) {
    const p = this.room.byId(playerId);
    if (!p) return { error: '你不在这个房间里' };
    const clean = String(text || '').trim().slice(0, 120);
    if (!clean) return { error: '说点什么吧' };
    const mine = this.messages.filter((m) => m.from === p.id);
    const last = mine.length ? mine[mine.length - 1] : null;
    if (last && Date.now() - last.ts < 700) return { error: '说得太快了，缓一下' };
    this.messages.push({
      id: ++this.msgSeq,
      from: p.id,
      name: p.name,
      avatar: avatarOf(p),
      text: clean,
      ts: Date.now(),
    });
    if (this.messages.length > 300) this.messages.shift();
    this.touch();
    return { ok: true };
  }


  /** 玩家自己记的笔记：怕忘了谁查出来过什么身份，随手标一下提醒自己。「不会改真实阵营」 */
  setNote(playerId, targetId, camp, rank) {
    const p = this.room.byId(playerId);
    if (!p) return { error: '你不在这个房间里' };
    const t = this.room.byId(targetId);
    if (!t) return { error: '找不到这名玩家' };
    if (t.id === p.id) return { error: '不用标记自己' };
    if (!camp) {
      delete p.notes[t.id];
      this.touch();
      return { ok: true };
    }
    if (!['red', 'blue', 'ronin'].includes(camp)) return { error: '无效的阵营' };
    let label;
    let r = null;
    if (camp === 'ronin') {
      label = '浪人';
    } else {
      r = Number(rank);
      if (!Number.isInteger(r) || r < 1 || r > MAX_PLAYERS) return { error: '无效的位次' };
      label = `${CAMP_NAME[camp]}${r}`;
    }
    p.notes[t.id] = { camp, rank: r, label };
    this.touch();
    return { ok: true };
  }

  nextAvatar(playerId) {
    const p = this.room.byId(playerId);
    if (!p) return { error: '你不在这个房间里' };
    const taken = new Set(this.room.players.filter((x) => x.id !== p.id).map((x) => x.avatar));
    for (let i = 1; i <= AVATARS.length; i++) {
      const cand = (p.avatar + i) % AVATARS.length;
      if (!taken.has(cand)) { p.avatar = cand; this.touch(); return { ok: true }; }
    }
    return { ok: true };
  }

  /** 离开房间：牌局进行中不让走，避免把人打残 */
  exitRoom(playerId) {
    const p = this.room.byId(playerId);
    if (!p) return { error: '你不在这个房间里' };
    if (!['lobby', 'result', 'gameover'].includes(this.phase)) {
      return { error: '这一轮还在打，等结束或者让房主结束本局' };
    }
    return this.room.removePlayer(playerId);
  }

  addBot(playerId) {
    const gate = this.#hostCheck(playerId);
    if (gate) return gate;
    if (this.phase !== 'lobby') return { error: '只能在开局前加人机' };
    if (this.room.players.length >= MAX_PLAYERS) return { error: `房间已满（最多 ${MAX_PLAYERS} 人）` };
    this.room.addBot();
    this.touch();
    return { ok: true };
  }

  removeBot(playerId, targetId) {
    const gate = this.#hostCheck(playerId);
    if (gate) return gate;
    if (this.phase !== 'lobby') return { error: '只能在开局前移除人机' };
    const r = this.room.removeBot(targetId);
    this.touch();
    return r;
  }

  start(playerId) {
    const gate = this.#hostCheck(playerId);
    if (gate) return gate;
    if (this.phase !== 'lobby') return { error: '游戏已经开始了' };
    if (this.busy) return { error: '正在复位上一局，等一下再点' };
    if (this.room.players.length < MIN_PLAYERS) return { error: `至少需要 ${MIN_PLAYERS} 名玩家` };
    this.#runRound();
    return { ok: true };
  }

  nextRound(playerId) {
    const gate = this.#hostCheck(playerId);
    if (gate) return gate;
    if (this.phase !== 'result') return { error: '现在不能开始下一轮' };
    this.#runRound();
    return { ok: true };
  }

  restart(playerId) {
    const gate = this.#hostCheck(playerId);
    if (gate) return gate;

    // 让还在等玩家的流程立刻收尾，避免它继续改动新的大厅状态
    this.aborted = true;
    for (const [pid, pending] of [...this.pendings.entries()]) {
      this.pendings.delete(pid);
      pending.resolve(pending.defaultKey);
    }

    this.round = 0;
    this.result = null;
    this.logs = [];
    this.phase = 'lobby';
    this.pendings.clear();
    this.discardPile = [];
    this.fillHonorPool();
    for (const p of this.room.players) {
      p.alive = true; p.camp = null; p.rank = null; p.revealed = false;
      p.hand = []; p.draft = []; p.honor = []; p.score = 0;
    }
    this.log('游戏已重置，所有人都回到了大厅。');
    this.touch();
    return { ok: true };
  }

  async #runRound() {
    if (this.busy) return;
    this.busy = true;
    this.aborted = false;
    try {
      this.round += 1;
      this.result = null;
      this.#resetForRound();
      this.log(`—— 第 ${this.round} 轮开始 ——`);
      this.#assignCamps();
      await this.#draft();
      if (this.aborted) return;
      await this.#night();
      if (this.aborted) return;
      this.#finishRound();
    } catch (e) {
      if (!this.aborted) {
        this.log(`⚠ 流程异常：${e && e.message}`);
        this.phase = 'result';
      }
    } finally {
      this.busy = false;
      if (this.aborted) this.aborted = false;
      else this.touch();
    }
  }

  #resetForRound() {
    for (const p of this.room.players) {
      p.alive = true;
      p.camp = null;
      p.rank = null;
      p.revealed = false;
      p.hand = [];
      p.draft = [];
      p.intel = {};
      p.notes = {};
    }
    this.summonKind = null;
    this.summonIndex = -1;
    this.pendings.clear();
  }

  #assignCamps() {
    const players = this.room.ordered;
    const n = players.length;
    const half = Math.floor(n / 2);
    const seatOrder = shuffle(players.slice());
    seatOrder.forEach((p, i) => {
      if (i < half) { p.camp = 'red'; p.rank = i + 1; }
      else if (i < half * 2) { p.camp = 'blue'; p.rank = i - half + 1; }
      else { p.camp = 'ronin'; p.rank = null; }
    });
    this.log(`阵营已分配：红队 ${half} 人，蓝队 ${half} 人${n % 2 ? '，另有 1 名浪人' : ''}。`);
  }

  /* ---------- 发牌：两轮传牌 ---------- */

  async #draft() {
    if (this.aborted) return;
    const players = this.room.ordered;
    const n = players.length;
    const deck = shuffle(buildDeck()).slice(0, n * 3);
    players.forEach((p, i) => { p.draft = deck.slice(i * 3, i * 3 + 3); });

    this.phase = 'draft1';
    this.log('第一轮抽牌：每人 3 张，选 1 张留下，其余 2 张传给下家。');
    const picks = await Promise.all(players.map(p => this.ask(p.id, {
      title: '第一轮抽牌',
      text: '选 1 张留下，没选的 2 张会传给你的下家。',
      format: 'cards',
      options: p.draft.map(cardOption),
      defaultKey: p.draft[0].id,
      timeoutMs: 180000,
    })));

    if (this.aborted) return;
    players.forEach((p, i) => {
      const keep = p.draft.find(c => c.id === picks[i]) || p.draft[0];
      if (!keep) return;
      p.hand.push(keep);
      p.draft = p.draft.filter(c => c.id !== keep.id);
    });

    const passing = players.map(p => p.draft);
    players.forEach((p, i) => { p.draft = passing[(i - 1 + n) % n]; });

    this.phase = 'draft2';
    this.log('第二轮抽牌：每人从上家拿到 2 张，选 1 张留下，另 1 张弃掉。');
    const picks2 = await Promise.all(players.map(p => this.ask(p.id, {
      title: '第二轮抽牌',
      text: '从这 2 张里选 1 张留下，另 1 张弃掉。',
      format: 'cards',
      options: p.draft.map(cardOption),
      defaultKey: p.draft[0].id,
      timeoutMs: 180000,
    })));

    if (this.aborted) return;
    const discarded = [];
    players.forEach((p, i) => {
      const keep = p.draft.find(c => c.id === picks2[i]) || p.draft[0];
      p.hand.push(keep);
      discarded.push(...p.draft.filter(c => c.id !== keep.id));
      p.draft = [];
    });
    this.discardPile = shuffle(discarded);
    this.log(`抽牌结束，弃牌堆有 ${this.discardPile.length} 张牌。`);
    if (process.env.FORCE_SOUL) {
      const human = this.room.ordered.find((x) => !x.isBot);
      if (human && !human.hand.some((c) => c.kind === 'trickster' && c.num === 4)) {
        human.hand.push({ id: 'trickster#4', kind: 'trickster', num: 4 });
      }
    }
    this.#botChatter();
  }

  /* ---------- 夜晚：按顺序召唤 ---------- */

  async #night() {
    if (this.aborted) return;
    this.phase = 'night';
    this.log('—— 夜晚降临 ——');
    const players = this.room.ordered;

    for (let idx = 0; idx < SUMMON_ORDER.length; idx++) {
      const kind = SUMMON_ORDER[idx];
      this.summonIndex = idx;
      this.summonKind = kind;
      const name = ACTIVE_META[kind].name;
      this.touch();

      const holders = [];
      for (const p of players) {
        if (!p.alive) continue;
        const cards = p.hand.filter(c => c.kind === kind);
        if (cards.length) holders.push({ p, cards });
      }
      if (!holders.length) {
        this.log(`召唤「${name}」：没有人持有这张牌。`);
        continue;
      }

      this.log(`召唤「${name}」：持有者同时决定是否使用。`);
      const decisions = await Promise.all(holders.map(async ({ p, cards }) => {
        const keys = [];
        let remaining = cards.slice();
        while (remaining.length) {
          const key = await this.ask(p.id, {
            title: `召唤「${name}」`,
            text: keys.length
              ? `本轮你已打出 ${keys.length} 张「${name}」，是否继续？`
              : `是否使用你的「${name}」？同种牌可以一张张连出。决定会同时亮出。`,
            format: 'cards',
            options: [
              ...remaining.map(cardOption),
              { key: '__none', label: keys.length ? '到此为止' : '不使用', desc: '保留这张牌（本阶段过后就作废了）' },
            ],
            defaultKey: '__none',
            timeoutMs: 180000,
          });
          if (!key || key === '__none') break;
          keys.push(key);
          remaining = remaining.filter(c => c.id !== key);
        }
        return { p, keys };
      }));

      const used = [];
      for (const d of decisions) {
        for (const key of d.keys) {
          const card = d.p.hand.find(c => c.id === key);
          if (card) used.push({ p: d.p, card });
        }
      }
      if (!used.length) {
        this.log(`「${name}」没有人使用。`);
        if (Math.random() < 0.5) this.#botChatter(0.35);
        continue;
      }

      used.sort((a, b) => a.card.num - b.card.num);
      this.log(`亮牌：${used.map(u => `${u.p.name}（${cardName(u.card)}）`).join('、')}`);
      for (const u of used) {
        if (this.aborted) return;
        this.#consumeCard(u.p, u.card);
        await this.#resolveCard(u.p, u.card);
      }
    }

    this.summonKind = null;
    this.summonIndex = -1;
    if (!this.aborted) this.touch();
  }

  #consumeCard(player, card) {
    player.hand = player.hand.filter(c => c.id !== card.id);
  }

  async #pickPlayer(player, title, filter) {
    const cands = this.room.ordered.filter(x =>
      x.alive && x.id !== player.id && (!filter || filter(x)));
    if (!cands.length) return null;
    const key = await this.ask(player.id, {
      title,
      text: '选择一名玩家：',
      format: 'players',
      options: [
        ...cands.map(x => ({ key: x.id, label: x.name, desc: x.revealed ? campLabel(x) : '' })),
        { key: '__none', label: '取消', desc: '什么都不做' },
      ],
      defaultKey: '__none',
    });
    if (!key || key === '__none') return null;
    return this.room.byId(key) || null;
  }

  async #confirm(player, title, text, yesLabel, noLabel) {
    const key = await this.ask(player.id, {
      title,
      text,
      options: [
        { key: 'yes', label: yesLabel },
        { key: 'no', label: noLabel },
      ],
      defaultKey: 'no',
    });
    return key === 'yes';
  }

  async #resolveCard(actor, card) {
    try {
      switch (card.kind) {
        case 'scout': return await this.#scout(actor, card);
        case 'hermit': return await this.#hermit(actor, card);
        case 'trickster': return await this.#trickster(actor, card);
        case 'assassin': return await this.#assassin(actor, card);
        case 'jonin': return await this.#jonin(actor, card);
        default: return undefined;
      }
    } catch (e) {
      this.log(`⚠ 技能结算异常（${cardName(card)}）：${e && e.message}`);
    }
  }

  /* ---------- 主动技能 ---------- */

  async #scout(actor, card) {
    const t = await this.#pickPlayer(actor, `【${cardName(card)}】查看谁的阵营牌？`);
    if (!t) return;
    this.log(`${actor.name} 用「密探${card.num}」查看了 ${t.name} 的阵营。`);
    this.#revealCamp(actor, t, `密探 ${card.num}`);
  }

  async #hermit(actor, card) {
    const t = await this.#pickPlayer(actor, `【${cardName(card)}】查看谁的阵营牌和一张忍者牌？`);
    if (!t) return;
    this.log(`${actor.name} 用「隐士${card.num}」查看了 ${t.name}。`);
    const one = t.hand.length ? t.hand[Math.floor(Math.random() * t.hand.length)] : null;
    this.#revealCamp(actor, t, `隐士 ${card.num}`, one);
  }

  async #trickster(actor, card) {
    switch (card.num) {
      case 1: return await this.#actorSwap(actor, card);
      case 2: return await this.#graveDigger(actor, card);
      case 3: return await this.#prankster(actor, card);
      case 4: return await this.#soulTrader(actor, card);
      case 5: return await this.#thief(actor, card);
      case 6: return await this.#judge(actor, card);
      default: return undefined;
    }
  }

  // 骗徒1 百变者
  async #actorSwap(actor, card) {
    const a = await this.#pickPlayer(actor, '【百变者】查看第 1 位玩家的阵营牌：');
    if (!a) return;
    const b = await this.#pickPlayer(actor, `【百变者】查看第 2 位玩家的阵营牌（第 1 位是 ${a.name}）`, x => x.id !== a.id);
    if (!b) {
      this.priv(actor, `🔍 ${a.name} 是「${campLabel(a)}」`);
      return;
    }
    this.log(`${actor.name} 用「百变者」查看了 ${a.name} 与 ${b.name}。`);
    this.#revealCamp(actor, a, '百变者');
    this.#revealCamp(actor, b, '百变者');
    const swap = await this.#confirm(actor, '百变者',
      `是否交换 ${a.name} 与 ${b.name} 的阵营牌？（他们看不到自己的新阵营）`, '交换', '不交换');
    if (!swap) { this.log(`${actor.name} 选择不交换。`); return; }
    const camp = a.camp, rank = a.rank;
    a.camp = b.camp; a.rank = b.rank;
    b.camp = camp; b.rank = rank;
    for (const p of this.room.players) {
      if (p.intel) { delete p.intel[a.id]; delete p.intel[b.id]; }
    }
    this.log(`${actor.name} 交换了 ${a.name} 与 ${b.name} 的阵营牌。`);
  }

  // 骗徒2 掘墓人
  async #graveDigger(actor, card) {
    if (this.discardPile.length < 1) {
      this.log(`${actor.name} 的「掘墓人」无牌可取。`);
      return;
    }
    const idxs = shuffle(this.discardPile.map((_, i) => i)).slice(0, 2);
    const shown = idxs.map(i => this.discardPile[i]);
    const key = await this.ask(actor.id, {
      title: '【掘墓人】弃牌堆',
      text: '查看两张弃牌，取走其中一张（也可以不取）。',
      format: 'cards',
      options: [
        ...shown.map(cardOption),
        { key: '__none', label: '都不取' },
      ],
      defaultKey: '__none',
    });
    if (!key || key === '__none') {
      this.log(`${actor.name} 放弃了掘墓。`);
      return;
    }
    const got = shown.find(c => c.id === key);
    if (!got) return;
    this.discardPile = this.discardPile.filter(c => c.id !== got.id);
    actor.hand.push(got);
    this.log(`${actor.name} 从弃牌堆带走了「${cardName(got)}」。`);

    const usableNow = KIND_INDEX[got.kind] !== undefined && KIND_INDEX[got.kind] >= this.summonIndex;
    if (!usableNow) {
      if (PASSIVE_META[got.kind]) this.priv(actor, '这张是被动牌，会自动生效。');
      else this.priv(actor, '这张牌对应的召唤阶段已经过去了，无法再使用。');
      return;
    }
    const now = await this.#confirm(actor, '掘墓人',
      `「${cardName(got)}」可以现在立刻使用，也能留到它自己的召唤阶段。`, '立刻使用', '先留着');
    if (!now) return;
    this.#consumeCard(actor, got);
    this.log(`${actor.name} 立刻使用了刚取得的「${cardName(got)}」。`);
    await this.#resolveCard(actor, got);
  }

  // 骗徒3 捣蛋鬼
  async #prankster(actor, card) {
    const t = await this.#pickPlayer(actor, '【捣蛋鬼】查看谁的阵营牌？');
    if (!t) return;
    this.log(`${actor.name} 用「捣蛋鬼」查看了 ${t.name} 的阵营。`);
    this.#revealCamp(actor, t, '捣蛋鬼');
    const reveal = await this.#confirm(actor, '捣蛋鬼', `要把 ${t.name} 的阵营牌公开给所有人吗？`, '公开', '保密');
    if (!reveal) return;
    t.revealed = true;
    this.log(`${actor.name} 公开了 ${t.name} 的阵营牌：${campLabel(t)}。`);
  }

  // 骗徒4 灵魂商贩
  async #soulTrader(actor, card) {
    const t = await this.#pickPlayer(actor, '【灵魂商贩】查看谁的荣誉标记或阵营牌？');
    if (!t) return;
    const key = await this.ask(actor.id, {
      title: '【灵魂商贩】',
      text: `要查看 ${t.name} 的什么？`,
      options: [
        { key: 'honor', label: '荣誉标记', desc: `能看到他每枚的分值（共 ${t.honor.length} 枚），交换时挑着换` },
        { key: 'camp', label: '阵营牌', desc: '换标记时看不到分值，只能随机摸' },
        { key: '__none', label: '取消' },
      ],
      defaultKey: '__none',
    });
    if (!key || key === '__none') return;
    if (key === 'honor') {
      this.log(`${actor.name} 用「灵魂商贩」查看了 ${t.name} 的荣誉标记。`);
      this.#revealHonor(actor, t, '灵魂商贩');
    } else {
      this.log(`${actor.name} 用「灵魂商贩」查看了 ${t.name} 的阵营。`);
      this.#revealCamp(actor, t, '灵魂商贩');
    }
    if (!actor.honor.length || !t.honor.length) {
      if (!actor.honor.length) this.priv(actor, '你自己还没有荣誉标记，这次换不了。');
      else this.priv(actor, `${t.name} 还没有荣誉标记，没得换。`);
      this.log('两边有一方没有荣誉标记，这次交换作罢。');
      return;
    }
    const knewHonorNow = key === 'honor';
    const theirSum = t.honor.reduce((x, y) => x + y, 0);
    const swap = await this.#confirm(actor, '灵魂商贩',
      knewHonorNow
        ? `要交换一个荣誉标记吗？他的标记是 ${t.honor.join(' + ')} = ${theirSum} 分，你可以挑着换。`
        : `要交换一个荣誉标记吗？（他 ${t.honor.length} 个）。你没查他的标记，换了只能随机摸一枚。`,
      '交换一个', '不交换');
    if (!swap) return;

    // 标记是暗的：分只有本人才知道，所以给哪一枚由双方各自挑
    const myIdx = await this.ask(actor.id, {
      title: '灵魂商贩 · 你给哪个',
      text: `选一枚你自己的荣誉标记交给 ${t.name}（分值只有你知道）。`,
      format: 'choices',
      options: [
        ...actor.honor.map((v, i) => ({ key: String(i), label: `${v} 分` })),
        { key: '__none', label: '算了，不换了' },
      ],
      defaultKey: '__none',
      botPick: 'min',
    });
    if (!myIdx || myIdx === '__none') {
      this.log(`${actor.name} 最后没有换。`);
      return;
    }
    const knewHonor = key === 'honor';
    let ti;
    if (knewHonor) {
      // 查过他的荣誉标记，就能看着分值挑
      const theirIdx = await this.ask(actor.id, {
        title: '灵魂商贩 · 你要哪枚',
        text: `你刚才看过他的标记，直接从 ${t.name} 这里挑一枚。`,
        format: 'choices',
        options: t.honor.map((v, i) => ({ key: String(i), label: `第${i + 1}枚 · ${v} 分` })),
        defaultKey: String(t.honor.indexOf(Math.max(...t.honor))),
        botPick: 'max',
      });
      ti = Number(theirIdx);
    } else {
      // 没查标记，只能随机摸一枚
      ti = Math.floor(Math.random() * t.honor.length);
      this.priv(actor, '你没看他的标记，随手摸了一枚。');
    }
    const mi = Number(myIdx);
    if (!Number.isInteger(mi)) return;
    const mineVal = actor.honor[mi];
    const theirsVal = t.honor[Number.isInteger(ti) ? ti : 0];
    if (mineVal === undefined || theirsVal === undefined) return;

    actor.honor.splice(mi, 1);
    t.honor.splice(Number.isInteger(ti) ? ti : 0, 1);
    actor.honor.push(theirsVal);
    t.honor.push(mineVal);
    actor.score += theirsVal - mineVal;
    t.score += mineVal - theirsVal;
    this.log(`${actor.name} 与 ${t.name} 交换了一个荣誉标记。`);
    this.priv(actor, `你交出 ${mineVal} 分，换到 ${theirsVal} 分。`);
    this.priv(t, `你交出 ${theirsVal} 分，换到 ${mineVal} 分。`);
  }

  // 骗徒5 窃贼
  async #thief(actor, card) {
    actor.revealed = true;
    this.log(`${actor.name} 用「窃贼」揭示自己的阵营牌：${campLabel(actor)}。`);
    const cands = this.room.ordered.filter(x => x.alive && x.id !== actor.id && x.honor.length > actor.honor.length);
    if (!cands.length) {
      this.log('没有人比他荣誉标记更多，无标记可拿。');
      return;
    }
    const t = await this.#pickPlayer(actor, '【窃贼】从谁那里拿走一个荣誉标记？', x => x.honor.length > actor.honor.length);
    if (!t) return;
    if (t.honor.length <= actor.honor.length) return;
    const taken = t.honor.splice(Math.floor(Math.random() * t.honor.length), 1)[0];
    actor.honor.push(taken);
    actor.score += taken;
    t.score -= taken;
    this.log(`${actor.name} 从 ${t.name} 那里拿走了 1 个荣誉标记。`);
    this.priv(actor, `拿到的标记值 ${taken} 分。`);
    this.priv(t, `你被拿走的标记值 ${taken} 分。`);
  }

  // 骗徒6 裁判
  async #judge(actor, card) {
    actor.revealed = true;
    this.log(`${actor.name} 用「裁判」揭示自己的阵营牌：${campLabel(actor)}，并指定击杀一人。`);
    const t = await this.#pickPlayer(actor, '【裁判】击杀谁？（无视「反杀」与「殉道者」）');
    if (!t) return;
    await this.#kill(actor, t, { ignorePassive: true });
  }

  async #assassin(actor, card) {
    const t = await this.#pickPlayer(actor, `【${cardName(card)}】击杀谁？`);
    if (!t) return;
    await this.#kill(actor, t);
  }

  async #jonin(actor, card) {
    const t = await this.#pickPlayer(actor, `【${cardName(card)}】查看谁的阵营牌？`);
    if (!t) return;
    this.log(`${actor.name} 用「上忍${card.num}」查看了 ${t.name}。`);
    this.#revealCamp(actor, t, `上忍 ${card.num}`);
    const yes = await this.#confirm(actor, `上忍 ${card.num}`, `要击杀 ${t.name} 吗？`, '击杀', '放过');
    if (!yes) return;
    await this.#kill(actor, t);
  }

  /* ---------- 击杀与被动 ---------- */

  async #kill(killer, target, opts = {}) {
    if (!target.alive) return;
    if (!killer.alive) {
      this.log(`${killer.name} 已经出局，击杀无效。`);
      return;
    }
    if (!opts.ignorePassive) {
      const passives = target.hand.filter(c => c.kind === 'reflector' || c.kind === 'martyr');
      if (passives.length) {
        const key = await this.ask(target.id, {
          title: '你被击杀了！',
          text: `${killer.name} 击杀了你。你可以翻开被动忍者牌应对。`,
          format: 'cards',
          options: [
            ...passives.map(cardOption),
            { key: '__none', label: '不发动' },
          ],
          defaultKey: '__none',
        });
        const pick = passives.find(c => c.id === key);
        if (pick) {
          this.#consumeCard(target, pick);
          if (pick.kind === 'reflector') {
            killer.alive = false;
            this.log(`${target.name} 翻开「${PASSIVE_META.reflector.name}」，反杀了 ${killer.name}！${target.name} 存活。`);
            return;
          }
          target.alive = false;
          const v = this.grantHonor(target);
          this.log(`${target.name} 翻开「殉道者」出局，并获得 1 个荣誉标记（${v} 分）。`);
          return;
        }
      }
    }
    target.alive = false;
    this.log(`${target.name} 被击杀，出局。`);
  }

  /** 把「查看」的结果记成结构化情报：前端能直观展示，玩家列表也能直接标出已知身份 */
  #revealCamp(actor, target, skill, handCard) {
    actor.intel[target.id] = { label: campLabel(target), camp: target.camp, rank: target.rank };
    this.#pushReveal({
      to: actor.id,
      kind: handCard ? 'hand' : 'camp',
      skill,
      camp: target.camp,
      rank: target.rank,
      campLabel: campLabel(target),
      target: { id: target.id, name: target.name, avatar: avatarOf(target) },
      card: handCard ? {
        title: cardTitle(handCard),
        num: handCard.num,
        name: cardName(handCard),
        tone: toneOf(handCard),
        desc: cardDesc(handCard),
      } : null,
    });
  }

  #revealHonor(actor, target, skill) {
    this.#pushReveal({
      to: actor.id,
      kind: 'honor',
      skill,
      honorCount: target.honor.length,
      honorMarks: target.honor.slice(),
      target: { id: target.id, name: target.name, avatar: avatarOf(target) },
      card: null,
    });
  }

  #pushReveal(data) {
    this.reveals.push({
      id: ++this.revealSeq,
      round: this.round,
      camp: null,
      rank: null,
      campLabel: null,
      card: null,
      ...data,
    });
    if (this.reveals.length > 300) this.reveals.shift();
    this.touch();
  }

  #holdsMastermind(p) { return p.hand.some(c => c.kind === 'mastermind'); }

  /* ---------- 结算 ---------- */

  #finishRound() {
    this.phase = 'reveal';
    for (const p of this.room.players) p.revealed = true;
    this.log('—— 夜晚结束，公开所有阵营牌 ——');

    const ps = this.room.ordered;
    const redAlive = ps.filter(p => p.alive && p.camp === 'red');
    const blueAlive = ps.filter(p => p.alive && p.camp === 'blue');
    const ronin = ps.find(p => p.camp === 'ronin') || null;

    let winnerText = '';
    let campResult = 'none';
    let honorees = [];

    const redMM = redAlive.some(p => this.#holdsMastermind(p));
    const blueMM = blueAlive.some(p => this.#holdsMastermind(p));
    const roninMM = !!(ronin && ronin.alive && this.#holdsMastermind(ronin));

    if (roninMM) {
      winnerText = `浪人持有「${PASSIVE_META.mastermind.name}」活到最后，浪人单独获胜 —— 红蓝两队本轮颗粒无收。`;
      campResult = 'ronin';
      honorees = [ronin];
    } else if (redMM) {
      winnerText = `红队存活者持有「${PASSIVE_META.mastermind.name}」，红队获胜。`;
      campResult = 'red';
      honorees = ps.filter(p => p.camp === 'red');
    } else if (blueMM) {
      winnerText = `蓝队存活者持有「${PASSIVE_META.mastermind.name}」，蓝队获胜。`;
      campResult = 'blue';
      honorees = ps.filter(p => p.camp === 'blue');
    } else {
      const cmp = compareRanks(redAlive.map(p => p.rank), blueAlive.map(p => p.rank));
      if (!redAlive.length && !blueAlive.length) {
        winnerText = '红蓝双方全部出局，本轮无人获胜。';
        campResult = 'none';
      } else if (cmp > 0) {
        winnerText = `红队存活者地位更高（红 ${redAlive.map(p => p.rank).join('+') || '全灭'} 对 蓝 ${blueAlive.map(p => p.rank).join('+') || '全灭'}），红队获胜。`;
        campResult = 'red';
        honorees = ps.filter(p => p.camp === 'red');
      } else if (cmp < 0) {
        winnerText = `蓝队存活者地位更高（蓝 ${blueAlive.map(p => p.rank).join('+') || '全灭'} 对 红 ${redAlive.map(p => p.rank).join('+') || '全灭'}），蓝队获胜。`;
        campResult = 'blue';
        honorees = ps.filter(p => p.camp === 'blue');
      } else {
        winnerText = '红蓝两队的存活者地位完全相同，本轮平局，存活者各得 1 个荣誉标记。';
        campResult = 'draw';
        honorees = [...redAlive, ...blueAlive];
      }
    }

    if (ronin && ronin.alive && !honorees.includes(ronin)) {
      honorees.push(ronin);
      winnerText += ' 浪人存活到最后，额外获得 1 个荣誉标记。';
    }

    const before = new Map(ps.map(p => [p.id, p.honor.length]));
    for (const p of new Set(honorees)) this.grantHonor(p);
    const deltas = {};
    for (const p of ps) deltas[p.id] = p.honor.length - (before.get(p.id) || 0);

    this.log(winnerText);

    const champ = ps.slice().sort((a, b) => b.score - a.score).find(p => p.score >= WIN_SCORE) || null;
    if (champ) {
      this.phase = 'gameover';
      this.log(`🏆 ${champ.name} 率先拿到 ${champ.score} 分，赢下整局游戏！`);
    } else {
      this.phase = 'result';
    }

    this.result = {
      round: this.round,
      winnerText,
      campResult,
      honorees: [...new Set(honorees)].map(p => p.id),
      deltas,
      champion: champ ? champ.id : null,
      summary: ps.map(p => ({
        id: p.id,
        name: p.name,
        camp: p.camp,
        rank: p.rank,
        alive: p.alive,
        honorCount: p.honor.length,
        score: p.score,
        delta: deltas[p.id] || 0,
        hand: p.hand.map(c => cardName(c)),
      })),
    };
    this.touch();
  }

  /* ---------- 视图 ---------- */

  /* 每轮结算：总分只有自己的可见，别人的显示为 null；整局结束(gameover)才全部公开 */
  #resultFor(viewerId) {
    const r = this.result;
    if (!r) return null;
    if (this.phase === 'gameover') return r;
    const summary = r.summary
      .slice()
      .sort((a, b) => b.score - a.score)
      .map((p) => ({ ...p, score: p.id === viewerId ? p.score : null }));
    return { ...r, summary };
  }

  #promptFor(id) {
    const pending = this.pendings.get(id);
    if (!pending) return null;
    const q = pending.q;
    return {
      title: q.title,
      text: q.text,
      format: q.format || 'choices',
      options: q.options.map(o => ({
        key: o.key,
        label: o.label,
        desc: o.desc || '',
        tone: o.tone || null,
        title: o.title || null,
        num: o.num === undefined ? null : o.num,
        kindLabel: o.kindLabel || null,
      })),
    };
  }

  viewFor(viewer) {
    const ps = this.room.ordered;
    const revealedAll = ['reveal', 'result', 'gameover'].includes(this.phase);
    const showCamp = (p) => p.id === viewer.id || revealedAll || p.revealed;

    const summon = this.summonKind ? {
      kind: this.summonKind,
      name: ACTIVE_META[this.summonKind].name,
      index: this.summonIndex,
      total: SUMMON_ORDER.length,
    } : null;

    return {
      code: this.room.code,
      phase: this.phase,
      round: this.round,
      hostId: this.room.hostId,
      isHost: this.room.hostId === viewer.id,
      canHost: this.room.hostId === viewer.id || this.#hostIsAway(),
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      winScore: WIN_SCORE,
      you: {
        id: viewer.id,
        name: viewer.name,
        avatar: avatarOf(viewer),
        avatarIndex: viewer.avatar,
        camp: viewer.camp,
        rank: viewer.rank,
        campLabel: viewer.camp ? campLabel(viewer) : null,
        alive: viewer.alive,
        revealed: viewer.revealed,
        hand: viewer.hand.map(c => ({
          id: c.id, kind: c.kind, num: c.num,
          name: cardName(c), title: cardTitle(c), kindLabel: cardKindLabel(c), desc: cardDesc(c), tone: toneOf(c),
        })),
        draft: viewer.draft.map(c => ({
          id: c.id, kind: c.kind, num: c.num,
          name: cardName(c), title: cardTitle(c), kindLabel: cardKindLabel(c), desc: cardDesc(c), tone: toneOf(c),
        })),
        honorCount: viewer.honor.length,
        score: viewer.score,
        marks: viewer.honor.slice(),
      },
      players: ps.map((p) => {
        const shown = showCamp(p);
        const known = viewer.intel ? viewer.intel[p.id] : null;
        const note = viewer.notes ? viewer.notes[p.id] : null;
        return {
          id: p.id,
          name: p.name,
          avatar: avatarOf(p),
          seat: p.seat,
          connected: p.connected,
          alive: p.alive,
          isYou: p.id === viewer.id,
          isBot: !!p.isBot,
          isHost: p.id === this.room.hostId,
          canEdit: this.phase !== 'lobby' && p.id !== viewer.id,
          handCount: p.hand.length,
          honorCount: p.honor.length,
          camp: shown ? p.camp : null,
          rank: shown ? p.rank : null,
          campLabel: shown ? campLabel(p) : (known ? known.label : null),
          campKey: shown ? p.camp : (known ? known.camp : null),
          isIntel: !shown && !!known,
          noteLabel: note ? note.label : null,
          noteCamp: note ? note.camp : null,
          isNote: !!note,
          score: p.id === viewer.id ? p.score : null,
        };
      }),
      logs: this.logs.filter(l => !l.to || l.to === viewer.id).slice(-40),
      prompt: this.#promptFor(viewer.id),
      waiting: ps.filter(p => this.pendings.has(p.id)).map(p => p.name),
      summon,
      summonOrder: SUMMON_ORDER.map(k => ACTIVE_META[k].name),
      result: this.#resultFor(viewer.id),
      discardCount: this.discardPile.length,
      messages: this.messages.slice(-60),
      reveals: this.reveals.filter((r) => r.to === viewer.id && r.round === this.round).slice(-8),
    };
  }
}

module.exports = {
  Room, Game, MIN_PLAYERS, MAX_PLAYERS, WIN_SCORE, avatarOf,
  SUMMON_ORDER, ACTIVE_META, AVATARS, cardName, campLabel,
};
