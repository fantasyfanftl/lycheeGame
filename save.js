// save.js — lycheeGame 跨设备存档同步客户端（服务器端最终版 v2：带访问口令）
// 单账号 · 自托管 · Tailscale · 零账号/零费用
//
// 用法：游戏页面在 <script> 前引入 <script src="save.js"></script>，然后：
//   SyncSave.load('merge')   → Promise<存档对象|null>（云端优先，本地缓存兜底）
//   SyncSave.store('merge', data) → 先写本地(立即生效)，再异步同步到服务器
//   SyncSave.clear('merge')  → 清空本地缓存与云端
//
// 地址策略：一律同源相对路径。页面从服务器 https 域名打开时，存档 API 就是
// 同域同路径下的 api/save，无跨域、无混合内容、不用写死 IP。
// 从 GitHub Pages 打开时该 API 不存在 → 自动回退本地 localStorage，单机照常玩。
//
// 访问口令：服务器若配置了口令，首次访问会弹出输入框，输入后存 localStorage
// （key=lycheeAccessCode），之后自动带上 x-access-code 请求头，无需重复输入。
// 服务器未配置口令（私网现状）时，一切行为与之前完全一致。
(function () {
  'use strict';

  // 相对当前页面 URL 解析，天然兼容 /lychee/ 这类子路径部署
  var API = new URL('api/save', window.location.href).href;
  var CODE_KEY = 'lycheeAccessCode';

  function getCode() { try { return localStorage.getItem(CODE_KEY) || ''; } catch (e) { return ''; } }
  function setCode(c) { try { localStorage.setItem(CODE_KEY, c); } catch (e) {} }

  function apiFetch(url, opts, tried) {
    opts = opts || {};
    var headers = {};
    for (var k in (opts.headers || {})) headers[k] = opts.headers[k];
    var code = getCode();
    if (code) headers['x-access-code'] = code;
    var payload = { method: opts.method || 'GET', headers: headers };
    if (opts.body) payload.body = opts.body;
    return fetch(url, payload).then(function (r) {
      if (r.status === 401) {
        if (tried) throw new Error('auth failed');
        var input = window.prompt('请输入存档访问口令（仅首次需要，会保存在本机）：');
        if (input) { setCode(input); return apiFetch(url, opts, true); }
        throw new Error('auth cancelled');
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.status === 204 ? null : r.json();
    });
  }

  var SyncSave = {
    load: function (game) {
      var key = 'syncSaveCache:' + game;
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) {}
      return apiFetch(API + '?game=' + encodeURIComponent(game)).then(function (data) {
        var cloud = (data && data.save) ? data.save : null;
        if (cloud) {
          try { localStorage.setItem(key, JSON.stringify(cloud)); } catch (e) {}
          return cloud;
        }
        return null;
      }).catch(function () {
        // 服务器不可达（没开机 / 不在 tailnet / 口令取消）→ 用本地缓存，单机照常玩
        return cached;
      });
    },

    store: function (game, data) {
      var key = 'syncSaveCache:' + game;
      try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
      try {
        apiFetch(API + '?game=' + encodeURIComponent(game), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ save: data })
        }).catch(function () {});
      } catch (e) {}
    },

    clear: function (game) {
      try { localStorage.removeItem('syncSaveCache:' + game); } catch (e) {}
      try { apiFetch(API + '?game=' + encodeURIComponent(game), { method: 'DELETE' }).catch(function () {}); } catch (e) {}
    }
  };

  window.SyncSave = SyncSave;
})();
