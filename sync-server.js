// sync-server.js — lycheeGame 自托管存档同步服务器（最终版）
// 单账号 · 零依赖（仅 Node 内置模块）· 只绑 127.0.0.1，经 tailscale serve 的 /lychee/ 路径对外
//
// 启动：  node sync-server.js              （默认端口 8900，对外路径前缀 /lychee）
// 改端口： $env:PORT=8900; node sync-server.js   (PowerShell)
//
// 部署在服务器 desktop-dp4gp6g（和游戏同目录，__dirname 即游戏根目录）：
//   对外转发： tailscale serve --bg https /lychee/ http://127.0.0.1:8900
//   游戏入口： https://desktop-dp4gp6g.tail87369e.ts.net/lychee/merge.html
//   存档 API： https://desktop-dp4gp6g.tail87369e.ts.net/lychee/api/save?game=merge
//
// 注意：仅限个人 tailnet（tailnet only），不暴露公网。存档存于本目录 .sync-data/。
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8900;
const BASE_PATH = (process.env.BASE_PATH || '/lychee').replace(/\/+$/, ''); // 去掉末尾斜杠
const ROOT = __dirname;                                   // 游戏根目录
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
  // 去掉对外路径前缀：/lychee/xxx → /xxx
  let p = url.pathname;
  if (BASE_PATH && p === BASE_PATH) p = '/';
  else if (BASE_PATH && p.startsWith(BASE_PATH + '/')) p = p.slice(BASE_PATH.length);
  if (p === '/api/save') return handleAPI(req, res, url);
  return handleStatic(req, res, decodeURIComponent(p));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[sync-server] lycheeGame 同步服务器已启动（最终版）');
  console.log('[sync-server] 监听: http://127.0.0.1:' + PORT + '  对外路径: ' + BASE_PATH);
});