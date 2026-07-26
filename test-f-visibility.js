const WebSocket = require('ws');

async function main() {
  const list = await fetch('http://localhost:9222/json/list').then(r => r.json());
  const target = list.find(t => t.url.includes('ipad-workstation'));
  if (!target) { console.log('page not found'); return; }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  function call(method, params = {}) {
    return new Promise(resolve => {
      id++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({id, method, params}));
    });
  }

  const errors = [];
  ws.on('message', d => {
    const msg = JSON.parse(d);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      console.log('[console]', msg.params.type, ...(msg.params.args?.map(a => a.value) || []));
    }
  });

  await new Promise(r => ws.on('open', r));
  await call('Runtime.enable');
  await new Promise(r => setTimeout(r, 1200));

  // 检查加载错误
  console.log('Load-time errors:', errors.length);
  errors.forEach(e => console.log('  ERR:', e.exceptionDetails?.text, e.exceptionDetails?.exception?.description?.slice(0, 500)));

  // 点击 F
  const clickR = await call('Runtime.evaluate', {
    expression: 'document.querySelector("[data-topic=\\"F\\"]")?.click(); "ok"',
    returnByValue: true
  });
  console.log('click:', JSON.stringify(clickR.result?.result || clickR.result?.exceptionDetails).slice(0, 300));

  await new Promise(r => setTimeout(r, 500));

  const stateR = await call('Runtime.evaluate', {
    expression: `
      (function(){
        var f = document.querySelector("[data-topic-content=\\"F\\"]");
        if (!f) return "F not found";
        var cs = window.getComputedStyle(f);
        return JSON.stringify({
          display: cs.display,
          visibility: cs.visibility,
          height: f.offsetHeight,
          width: f.offsetWidth,
          inline: f.getAttribute("style"),
          childCount: f.children.length,
          firstChild: f.children[0] && (f.children[0].tagName + "." + f.children[0].className).slice(0, 80),
          activeCard: document.querySelector(".topic-card.active")?.getAttribute("data-topic")
        });
      })()
    `,
    returnByValue: true
  });
  console.log('F state:', stateR.result?.result?.value);

  console.log('Runtime errors after click:', errors.length);
  errors.forEach(e => console.log('  ERR:', e.exceptionDetails?.text, e.exceptionDetails?.exception?.description?.slice(0, 500)));

  ws.close();
}

main().catch(e => { console.error('main failed:', e); process.exit(1); });
