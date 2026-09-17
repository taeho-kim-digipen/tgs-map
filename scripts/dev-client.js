// Injected only by the local development server; never included in dist/.
(() => {
  const initialVersion = document.currentScript.dataset.tgsDevVersion;
  const host = document.createElement('div');
  host.id = 'tgs-dev-status';
  host.style.cssText = 'position:absolute;right:8px;bottom:8px;z-index:6;pointer-events:auto;touch-action:manipulation;';
  const shadow = host.attachShadow({mode:'open'});
  const style = document.createElement('style');
  style.textContent = 'button{display:block;box-sizing:border-box;border:1px solid #ffffff88;border-radius:14px;background:#173a32ee;color:white;min-height:28px;min-width:28px;padding:5px 10px;font:11px/16px -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 1px 5px #0002;touch-action:manipulation;cursor:pointer}button:focus-visible{outline:3px solid #2e8bb8;outline-offset:2px}button[data-offline=true]{background:#794011ee}';
  const button = document.createElement('button');
  button.type = 'button';
  shadow.append(style, button);
  const viewport = document.getElementById('viewport');
  if (!viewport) host.style.position = 'fixed';
  (viewport || document.body).appendChild(host);

  let collapsed = true;
  try { collapsed = sessionStorage.getItem('tgs-dev-status-collapsed') !== 'false'; } catch {}
  let connected = false;
  let checking = false;
  let reloading = false;

  function showStatus(message, online) {
    connected = online;
    button.textContent = collapsed ? '●' : message;
    button.dataset.offline = String(!online);
    button.title = message + (collapsed ? ' · 펼치기' : ' · 접기');
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-expanded', String(!collapsed));
  }
  showStatus('개발 서버 연결 확인 중', false);
  for (const eventName of ['pointerdown', 'pointerup', 'touchstart', 'touchend']) {
    host.addEventListener(eventName, event => event.stopPropagation());
  }
  button.addEventListener('click', event => {
    event.stopPropagation();
    collapsed = !collapsed;
    try { sessionStorage.setItem('tgs-dev-status-collapsed', String(collapsed)); } catch {}
    showStatus(connected ? '● 개발 연결됨 · 자동 반영' : '● PC 연결 대기 중', connected);
  });

  async function checkVersion() {
    if (document.hidden || checking || reloading) return;
    checking = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch('/__tgs_dev/version', {cache:'no-store', signal:controller.signal});
      if (!response.ok) throw new Error('Development server unavailable');
      const result = await response.json();
      if (typeof result.version !== 'string') throw new Error('Invalid development version');
      if (result.version !== initialVersion) {
        reloading = true;
        showStatus('변경 사항 반영 중…', true);
        location.reload();
        return;
      }
      showStatus('● 개발 연결됨 · 자동 반영', true);
    } catch {
      showStatus('● PC 연결 대기 중', false);
    } finally {
      clearTimeout(timeout);
      checking = false;
    }
  }

  // Safari pauses background tabs. Returning also checks server restarts.
  document.addEventListener('visibilitychange', checkVersion);
  window.addEventListener('pageshow', checkVersion);
  window.addEventListener('online', checkVersion);
  window.addEventListener('focus', checkVersion);
  setInterval(checkVersion, 1500);
  checkVersion();
})();
