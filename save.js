// save.js — lycheeGame 跨设备存档同步客户端
// 单账号 · 自托管 · Tailscale · 零账号/零费用
// 用法：游戏页面在 <script> 前引入 <script src="save.js"></script>，然后：
//   SyncSave.load('merge')            → Promise<存档对象|null>，云端优先，本地缓存兜底
//   SyncSave.store('merge', data)     → 先写本地(立即生效)，再异步同步到服务器
//   SyncSave.clear('merge')           → 清空本地缓存与云端
// 规则：单账号，云端存档默认最新（每次 store 都推送），load 时云端有就用云端。
// 地址：API 用「同源相对路径」解析——页面在哪，API 就在哪。服务器部署：
//       https://域名/lychee/merge.html → API = https://域名/lychee/api/save
//       GitHub Pages 打开时无 API → 自动回退本地缓存，不影响单机玩。
(function () {
  'use strict';

  var LS_PREFIX = 'syncSaveCache:';

  // 相对当前页面解析 API 地址（同源，无跨域 / 无混合内容问题）
  function apiUrl(game) {
    var base = new URL('api/save', window.location.href).href;
    var sep = base.indexOf('?') >= 0 ? '&' : '?';
    return base + sep + 'game=' + encodeURIComponent(game);
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