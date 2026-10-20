// save.js — lycheeGame 跨设备存档同步客户端
// 单账号 · 自托管 · Tailscale · 零账号/零费用
// 用法：游戏页面在 <script> 前引入 <script src="save.js"></script>，然后：
//   SyncSave.load('merge')            → Promise<存档对象|null>，云端优先，本地缓存兜底
//   SyncSave.store('merge', data)     → 先写本地(立即生效)，再异步同步到这台电脑
//   SyncSave.clear('merge')           → 清空本地缓存与云端
// 规则：单账号，云端存档默认最新（每次 store 都推送），load 时云端有就用云端。
(function () {
  'use strict';

  var SERVER_PORT = 8900;
  var PC_HOSTS = ['100.64.232.48', '127.0.0.1', 'localhost', '::1'];
  var LS_PREFIX = 'syncSaveCache:';

  function serverBase() {
    var host = String(window.location.hostname).toLowerCase();
    // 本页直接跑在这台电脑（自托管 / 本机调试）→ 同源，走相对路径
    if (PC_HOSTS.indexOf(host) !== -1) return window.location.origin;
    // 否则（如 GitHub Pages 打开）→ 指向这台电脑的 Tailscale 地址
    return 'http://100.64.232.48:' + SERVER_PORT;
  }

  function apiUrl(game) {
    return serverBase() + '/api/save?game=' + encodeURIComponent(game);
  }

  function fetchJSON(url, opts) {
    return fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.status === 204 ? null : r.json();
    });
  }

  var SyncSave = {
    load: function (game) {
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem(LS_PREFIX + game) || 'null'); } catch (e) {}
      return fetchJSON(apiUrl(game)).then(function (data) {
        var cloud = (data && data.save) ? data.save : null;
        if (cloud) {
          try { localStorage.setItem(LS_PREFIX + game, JSON.stringify(cloud)); } catch (e) {}
          return cloud;
        }
        return null;
      }).catch(function () {
        // 云端不可达（服务器没开 / 不在 tailnet）→ 回退本地缓存，单机照常玩
        return cached;
      });
    },

    store: function (game, data) {
      // 先写本地缓存（立即生效），再异步同步云端
      try { localStorage.setItem(LS_PREFIX + game, JSON.stringify(data)); } catch (e) {}
      try {
        fetchJSON(apiUrl(game), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ save: data })
        }).catch(function () {});
      } catch (e) {}
    },

    clear: function (game) {
      try { localStorage.removeItem(LS_PREFIX + game); } catch (e) {}
      try { fetchJSON(apiUrl(game), { method: 'DELETE' }).catch(function () {}); } catch (e) {}
    }
  };

  window.SyncSave = SyncSave;
})();