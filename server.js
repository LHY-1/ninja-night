'use strict';
/* 局域网服务端：静态页面 + JSON 接口 + SSE 长连接推送。零依赖。 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { Room, MIN_PLAYERS, MAX_PLAYERS, WIN_SCORE, AVATARS } = require('./engine.js');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 7788;

const rooms = new Map();
const conns = new Map(); // token -> Set<res>

/* ------------------------- 工具 ------------------------- */

const newToken = () => crypto.randomBytes(16).toString('hex');

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const acceptsGzip = (res) => String((res.req && res.req.headers['accept-encoding']) || '').includes('gzip');

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Private-Network': 'true',
  };
  if (acceptsGzip(res) && body.length > 512) {
    zlib.gzip(body, (err, buf) => {
      if (err) { res.writeHead(code, headers); res.end(body); return; }
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(code, headers);
      res.end(buf);
    });
    return;
  }
  res.writeHead(code, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 200000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

/* ------------------------- SSE ------------------------- */

function attachSSE(room, player, req, res) {
  const useGzip = acceptsGzip(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...(useGzip ? { 'Content-Encoding': 'gzip' } : {}),
  });
  if (res.flushHeaders) res.flushHeaders();

  let out = res;
  if (useGzip) {
    out = zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED, flush: zlib.constants.Z_SYNC_FLUSH });
    out.pipe(res);
  }

  let set = conns.get(player.token);
  if (!set) { set = new Set(); conns.set(player.token, set); }
  set.add(res);
  player.connected = true;

  const push = () => {
    try {
      out.write(`data: ${JSON.stringify(room.game.viewFor(player))}\n\n`);
    } catch { /* 连接已断 */ }
  };
  room.onUpdate(push);
  push();
  room.broadcast();

  const heartbeat = setInterval(() => {
    try { out.write(': ping\n\n'); } catch { /* ignore */ }
  }, 25000);

  const cleanup = () => {
    clearInterval(heartbeat);
    room.offUpdate(push);
    set.delete(res);
    try { if (out !== res) out.end(); } catch { /* ignore */ }
    if (!set.size) {
      conns.delete(player.token);
      player.connected = false;
      room.broadcast();
    }
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
}

/* ------------------------- 接口 ------------------------- */

async function handleApi(pathname, req, res) {
  if (pathname === '/api/meta') {
    return sendJson(res, 200, { avatars: AVATARS, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, winScore: WIN_SCORE });
  }

  if (req.method !== 'POST') return sendJson(res, 405, { error: '只支持 POST' });
  const body = await readBody(req);

  if (pathname === '/api/create') {
    const code = makeCode();
    const room = new Room(code);
    rooms.set(code, room);
    const token = newToken();
    let player;
    try {
      player = room.addPlayer(body.name, token, body.avatar);
    } catch (e) {
      rooms.delete(code);
      return sendJson(res, 400, { error: e.message });
    }
    return sendJson(res, 200, { ok: true, code, token, playerId: player.id, hostId: room.hostId });
  }

  if (pathname === '/api/join') {
    const code = String(body.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return sendJson(res, 404, { error: '房间不存在，检查一下房号' });

    // 同一个 token 再次进入视为重连
    if (body.token) {
      const existing = room.byToken(body.token);
      if (existing) {
        if (body.name && !room.game.phase.startsWith('lobby')) { /* 游戏中不改名 */ }
        return sendJson(res, 200, { ok: true, code, token: body.token, playerId: existing.id });
      }
    }
    if (room.players.length >= 11) return sendJson(res, 400, { error: '房间已满（最多 11 人）' });
    if (room.game.phase !== 'lobby' && room.players.length) {
      // 允许中途以旁观者身份进入？这里直接拒绝，避免破坏对局
      return sendJson(res, 400, { error: '这局已经开始了，请等下一轮或新建房间' });
    }
    if (!String(body.name || '').trim()) return sendJson(res, 400, { error: '请先填一个昵称' });

    const token = newToken();
    let player;
    try {
      player = room.addPlayer(body.name, token, body.avatar);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
    return sendJson(res, 200, { ok: true, code, token, playerId: player.id });
  }

  if (pathname === '/api/action') {
    const room = rooms.get(String(body.code || '').toUpperCase());
    if (!room) return sendJson(res, 404, { error: '房间已失效' });
    const player = room.byToken(body.token);
    if (!player) return sendJson(res, 401, { error: '你不在这个房间里' });

    const game = room.game;
    let result;
    switch (body.action) {
      case 'answer': result = game.submit(player.id, body.key); break;
      case 'addBot': result = game.addBot(player.id); break;
      case 'removeBot': result = game.removeBot(player.id, body.target); break;
      case 'rename': result = game.rename(player.id, body.name); break;
      case 'avatar': result = game.nextAvatar(player.id); break;
      case 'setAvatar': result = game.setAvatar(player.id, body.avatar); break;
      case 'setNote': result = game.setNote(player.id, body.target, body.camp, body.rank); break;
      case 'say': result = game.say(player.id, body.text); break;
      case 'leave': {
        result = game.exitRoom(player.id);
        if (result && result.ok && room.players.length === 0) rooms.delete(room.code);
        break;
      }
      case 'start': result = game.start(player.id); break;
      case 'next': result = game.nextRound(player.id); break;
      case 'restart': result = game.restart(player.id); break;
      default: result = { error: '未知操作' };
    }
    return sendJson(res, result && result.error ? 400 : 200, result || { ok: true });
  }

  if (pathname === '/api/state') {
    const room = rooms.get(String(body.code || '').toUpperCase());
    if (!room) return sendJson(res, 404, { error: '房间已失效' });
    const player = room.byToken(body.token);
    if (!player) return sendJson(res, 401, { error: '你不在这个房间里' });
    return sendJson(res, 200, { ok: true, view: room.game.viewFor(player) });
  }

  return sendJson(res, 404, { error: '接口不存在' });
}

/* ------------------------- 静态文件 ------------------------- */

function serveStatic(pathname, res) {
  let rel = pathname;
  try { rel = decodeURIComponent(pathname); } catch { /* 保持原样 */ }
  if (rel.endsWith('/')) rel += 'index.html';  /* 目录路径自动补 index.html */
  if (rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
    const etag = '"' + crypto.createHash('md5').update(data).digest('hex') + '"';
    if ((res.req.headers['if-none-match'] || '') === etag) {
      res.writeHead(304, { ETag: etag }); res.end(); return;
    }
    const headers = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
    };
    const COMPRESSIBLE = /.(html|js|css|json|svg)$/i;
    if (acceptsGzip(res) && COMPRESSIBLE.test(file) && data.length > 512) {
      zlib.gzip(data, (gErr, buf) => {
        if (gErr) { res.writeHead(200, headers); res.end(data); return; }
        headers['Content-Encoding'] = 'gzip';
        res.writeHead(200, headers);
        res.end(buf);
      });
      return;
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

/* ------------------------- 服务 ------------------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/stream') {
    const room = rooms.get(String(url.searchParams.get('code') || '').toUpperCase());
    if (!room) { res.writeHead(404); res.end('room not found'); return; }
    const player = room.byToken(url.searchParams.get('token'));
    if (!player) { res.writeHead(401); res.end('unauthorized'); return; }
    return attachSSE(room, player, req, res);
  }

  if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Max-Age': '600',
    });
    return res.end();
  }

  if (url.pathname === '/api/lan') {
    const ips = [];
    for (const infos of Object.values(os.networkInterfaces()))
      for (const info of infos || [])
        if (info.family === 'IPv4' && !info.internal) ips.push(info.address);
    const cb = url.searchParams.get('callback');
    if (cb && /^[A-Za-z_$][\w$]*$/.test(cb)) {   /* JSONP:绕过 Safari 对私网 fetch 的拦截 */
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      return res.end(cb + '(' + JSON.stringify({ ok: true, ips }) + ')');
    }
    return sendJson(res, 200, { ok: true, ips });
  }

  if (url.pathname.startsWith('/api/')) {
    try { return await handleApi(url.pathname, req, res); }
    catch (e) {
      console.error('API 错误:', e);
      return sendJson(res, 500, { error: '服务器内部错误' });
    }
  }

  if (url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, rooms: rooms.size });
  }

  serveStatic(url.pathname, res);
});

/* 定期清理空房间：所有人离线超过 40 分钟就回收 */
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyoneOnline = room.players.some(p => p.connected);
    if (!anyoneOnline && now - room.createdAt > 40 * 60 * 1000) {
      rooms.delete(code);
    }
  }
}, 5 * 60 * 1000).unref();

function lanUrls(port) {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) out.push(`http://${info.address}:${port}`);
    }
  }
  return out;
}

server.listen(PORT, '::', () => {  // 双栈: 同时接受 IPv6 直连与 IPv4
  const lines = [
    '',
    '  忍者之夜 · 局域网对局服务已启动',
    '',
    `  本机打开:   http://localhost:${PORT}`,
  ];
  const lan = lanUrls(PORT);
  if (lan.length) {
    lines.push('  手机/其他电脑（同一 WiFi）:');
    for (const u of lan) lines.push(`    ${u}`);
  } else {
    lines.push('  ⚠ 没有找到局域网地址，检查一下网络连接');
  }
  lines.push('', '  按 Ctrl+C 停止服务', '');
  console.log(lines.join('\n'));
});
