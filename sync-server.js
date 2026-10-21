// sync-server.js — lycheeGame 自托管存档同步服务器（服务器端最终版 v2：带访问口令）
// 单账号 · 零依赖（仅 Node 内置模块）· 只绑本机 + tailscale serve 转发对外
//
// 启动：  node sync-server.js
// 默认：  监听 127.0.0.1:8900；经 tailscale serve 把 https://域名/lychee/ 转发进来
// 改端口：$env:PORT=9000; node sync-server.js
// 改前缀：$env:BASE_PATH='/lychee'; node sync-server.js
//
// 职责：1) 出游戏静态文件（本目录即 lycheeGame）
//       2) 存档 API：GET / PUT / DELETE  /api/save?game=xxx
// 存档落盘：本目录 .sync-data/（gitignore，不进仓库）
//
// 访问控制（可选口令，默认关闭）：
//   · 未配置口令 → 不鉴权（私网 tailnet 现状，行为不变）
//   · 配置口令后 → 存档 API 必须带请求头 x-access-code，否则 401
//   · 口令来源优先级：环境变量 ACCESS_CODE > .sync-data/access.json 的 {"code":"..."}
//   · 改口令即时生效（每次请求实时读，无需重启）
//   · 公网化（Funnel）前必须先配置口令，避免存档裸奔
// 安全：只绑 127.0.0.1 不暴露公网；静态游戏文件公开可读（无敏感信息），存档受口令保护。
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT, 10) || 8900;
const HOST = '127.0.0.1';
const BASE_PATH = (process.env.BASE_PATH || '/lychee').replace(/\/+$/, '');
const ROOT = __dirname;                                     // 即 lycheeGame 目录
const DATA_DIR = path.join(ROOT, '.sync-data');
const ACCESS_FILE = path.join(DATA_DIR, 'access.json');

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

// ---- 访问口令 ----
function loadAccessCode() {
  try {
    const raw = JSON.parse(fs.readFileSync(ACCESS_FILE, 'utf8'));
    if (raw && typeof raw.code === 'string' && raw.code) return raw.code;
  } catch (e) {}
  return '';
}
function currentAccessCode() {
  if (process.env.ACCESS_CODE) return process.env.ACCESS_CODE;
  return loadAccessCode();
}
function codeOk(header) {
  const code = currentAccessCode();
  if (!code) return true; // 未配置口令 = 不鉴权
  if (typeof header !== 'string' || header.length !== code.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i++) diff |= header.charCodeAt(i) ^ code.charCodeAt(i);
  return diff === 0;
}

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-access-code',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
function sendJSON(res, code, obj) { send(res, code, JSON.stringify(obj)); }

function safeName(name) {
  // 只允许字母数字 _ -，防路径穿越
  return /^[A-Za-z0-9_-]{1,64}$/.test(name) ? name : null;
}

// tailscale serve 会把 /lychee/* 原样转发进来，这里去掉前缀
function stripBase(p) {
  if (BASE_PATH && p.startsWith(BASE_PATH + '/')) return p.slice(BASE_PATH.length);
  if (BASE_PATH && p === BASE_PATH) return '/';
  return p;
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
  const p = stripBase(decodeURIComponent(url.pathname));
  if (p === '/api/save') {
    if (!codeOk(req.headers['x-access-code'])) {
      return sendJSON(res, 401, { error: 'access code required' });
    }
    return handleAPI(req, res, url);
  }
  return handleStatic(req, res, p);
});

server.listen(PORT, HOST, () => {
  console.log('[sync-server] lycheeGame 同步服务器已启动: http://' + HOST + ':' + PORT);
  console.log('[sync-server] 对外入口: https://desktop-dp4gp6g.tail87369e.ts.net' + BASE_PATH + '/');
  console.log('[sync-server] 存档目录: ' + DATA_DIR);
  console.log('[sync-server] 访问口令: ' + (currentAccessCode() ? '已启用' : '未配置（默认不鉴权）'));
});
