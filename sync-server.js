// sync-server.js — lycheeGame 自托管存档同步服务器
// 单账号 · 零依赖（只用 Node 内置模块）· Tailscale 内网访问
//
// 启动：  node sync-server.js            （默认端口 8900）
// 改端口： $env:PORT=8900; node sync-server.js   (PowerShell)
//
// 原理：这台电脑当服务器，存档存在本机 .sync-data/ 目录。
//      iPhone 等设备经 Tailscale 访问 http://100.64.232.48:8900 读写同一份存档。
//      这台电脑需开机 + Tailscale 在线，同步才工作。
//
// 注意：仅限你个人的 tailnet/LAN 使用，不做登录鉴权（单账号）。别暴露到公网。
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8900;
const ROOT = __dirname;                                   // 即 lycheeGame 目录
const DATA_DIR = path.join(ROOT, '.sync-data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
function sendJSON(res, code, obj) { send(res, code, JSON.stringify(obj)); }

function safeName(name) {
  // 只允许字母数字 _ -，防路径穿越
  return /^[A-Za-z0-9_-]{1,64}$/.test(name) ? name : null;
}

function handleAPI(req, res, url) {
  const game = url.searchParams.get('game');
  if (!game || !safeName(game)) return sendJSON(res, 400, { error: 'bad game name' });
  const file = path.join(DATA_DIR, game + '.json');

  if (req.method === 'GET') {
    if (!fs.existsSync(file)) return sendJSON(res, 404, { error: 'no save yet' });
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { return sendJSON(res, 500, { error: 'read fail' }); }
    return sendJSON(res, 200, raw);
  }

  if (req.method === 'PUT') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let obj;
      try { obj = JSON.parse(body); }
      catch (e) { return sendJSON(res, 400, { error: 'bad json' }); }
      try { fs.writeFileSync(file, JSON.stringify(obj), 'utf8'); }
      catch (e) { return sendJSON(res, 500, { error: 'write fail' }); }
      sendJSON(res, 200, { ok: true, savedAt: Date.now() });
    });
    return;
  }

  if (req.method === 'DELETE') {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); sendJSON(res, 200, { ok: true }); }
    catch (e) { sendJSON(res, 500, { error: 'delete fail' }); }
    return;
  }

  sendJSON(res, 405, { error: 'method not allowed' });
}

function handleStatic(req, res, pathname) {
  let filePath = path.normalize(path.join(ROOT, pathname));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  }
  if (filePath === ROOT || pathname === '/') filePath = path.join(ROOT, 'index.html');
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return send(res, 404, 'Not Found', 'text/plain; charset=utf-8');
  }
  const ext = path.extname(filePath).toLowerCase();
  send(res, 200, fs.readFileSync(filePath), MIME[ext] || 'application/octet-stream');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (url.pathname === '/api/save') return handleAPI(req, res, url);
  return handleStatic(req, res, decodeURIComponent(url.pathname));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[sync-server] lycheeGame 同步服务器已启动');
  console.log('[sync-server] 本机:      http://localhost:' + PORT);
  console.log('[sync-server] Tailscale: http://100.64.232.48:' + PORT + '   ← iPhone 用这个');
});