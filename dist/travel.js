'use strict';
(() => {
  const KEY = 'tgs2026-interest-booths-v1';
  function validateBackup(value, validIds) {
    if (!value || value.format !== 'tgs2026-interests' || value.version !== 1 || !Array.isArray(value.boothIds)) throw new Error('이 지도에서 만든 관심 목록 백업 파일을 선택해 주세요.');
    if (value.boothIds.length > validIds.size || value.boothIds.some(id => typeof id !== 'string' || !validIds.has(id))) throw new Error('확인할 수 없는 부스 번호가 들어 있습니다.');
    return [...new Set(value.boothIds)];
  }
  function makeBackup(ids) { return {format:'tgs2026-interests', version:1, boothIds:[...new Set(ids)]}; }
  if (typeof module !== 'undefined' && module.exports) { module.exports = {validateBackup, makeBackup}; return; }
  const $ = id => document.getElementById(id);
  const status = $('offline-status'), saveButton = $('offline-save');
  const isDevelopment = !!document.querySelector('script[data-tgs-dev-version]');
  let busy = false;
  let mapData;
  const getData = () => mapData || (mapData = fetch('./map-data.json?v=3').then(response => {
    if (!response.ok) throw new Error('지도 데이터를 읽지 못했습니다.');
    return response.json();
  }).catch(error => { mapData = null; throw error; }));

  function workerStatus(worker, type = 'TGS_TRAVEL_STATUS') {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('저장 상태를 확인하지 못했습니다. 다시 확인해 주세요.')); }, type === 'TGS_TRAVEL_PREPARE' ? 90000 : 8000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
      worker.postMessage({type}, [channel.port2]);
    });
  }
  function waitForControl(registration) {
    return new Promise((resolve, reject) => {
      let watched;
      const finish = error => {
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener('controllerchange', check);
        registration.removeEventListener('updatefound', watch);
        watched?.removeEventListener('statechange', check);
        error ? reject(error) : resolve();
      };
      const check = () => {
        status.dataset.workerState = watched?.state || registration.active?.state || 'none';
        if (navigator.serviceWorker.controller) finish();
        else if (watched?.state === 'redundant') finish(new Error('전체 지도를 저장하지 못했습니다. 인터넷 연결과 저장 공간을 확인해 주세요.'));
      };
      const watch = () => {
        watched?.removeEventListener('statechange', check);
        watched = registration.installing || registration.waiting || registration.active;
        watched?.addEventListener('statechange', check);
        check();
      };
      const timer = setTimeout(() => finish(new Error('저장 시간이 오래 걸립니다. 연결을 확인한 뒤 다시 시도해 주세요.')), 90000);
      navigator.serviceWorker.addEventListener('controllerchange', check);
      registration.addEventListener('updatefound', watch);
      watch();
    });
  }

  async function prepareOffline() {
    if (busy) return;
    if (isDevelopment) {
      status.textContent = '개발용 주소입니다. 여행용 배포 주소에서 오프라인 저장을 완료해 주세요.';
      saveButton.disabled = true;
      return;
    }
    if (!window.isSecureContext || !('serviceWorker' in navigator)) {
      status.textContent = '여행용 HTTPS 주소를 Safari에서 열어 주세요. 이 주소에서는 오프라인 설치를 지원하지 않습니다.';
      saveButton.disabled = true;
      return;
    }
    busy = true; saveButton.disabled = true;
    status.textContent = '전체 지도 7개와 부스 정보를 저장하는 중…';
    status.dataset.state = 'saving';
    try {
      let worker = navigator.serviceWorker.controller;
      if (!worker) {
        const registration = await navigator.serviceWorker.register('./sw.js', {scope:'./', updateViaCache:'none'});
        await waitForControl(registration);
        worker = navigator.serviceWorker.controller;
      }
      let result = await workerStatus(worker);
      const pageVersion=document.querySelector('meta[name="tgs-travel-version"]')?.content;
      if(pageVersion&&result.version!==pageVersion)throw new Error('지도 업데이트가 있습니다. 인터넷에 연결한 상태에서 앱을 닫았다 다시 열어 주세요.');
      if (!result.ready) result = await workerStatus(worker, 'TGS_TRAVEL_PREPARE');
      if (!result.ready) throw new Error(result.error || '아직 전체 저장이 끝나지 않았습니다. 인터넷에 연결한 뒤 다시 시도해 주세요.');
      status.textContent = '오프라인 준비 완료 · 1–11홀 / 인디 / 편의시설';
      status.dataset.state = 'ready';
      saveButton.textContent = '저장 상태 다시 확인';
    } catch (error) {
      status.textContent = error.message || '저장을 완료하지 못했습니다. 인터넷에 연결해 다시 시도해 주세요.';
      status.dataset.state = 'error';
    } finally { busy = false; saveButton.disabled = false; }
  }
  saveButton.addEventListener('click', prepareOffline);
  prepareOffline();

  function transferStatus(message) { $('interest-transfer-status').hidden = false; $('interest-transfer-status').textContent = message; }
  $('interest-export').addEventListener('click', async () => {
    try {
      const data = await getData();
      const validIds = new Set(data.booths.map(booth => booth.id));
      const raw = localStorage.getItem(KEY);
      const ids = raw === null ? data.defaults : JSON.parse(raw);
      if (!Array.isArray(ids)) throw new Error('현재 관심 목록을 읽지 못했습니다.');
      const backup = makeBackup(ids.filter(id => validIds.has(id)));
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'}));
      const link = document.createElement('a');
      link.href = url; link.download = 'TGS-2026-interest-booths.json';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      transferStatus(`관심 부스 ${backup.boothIds.length}개 백업을 준비했습니다. 파일 앱에 저장해 주세요.`);
    } catch (error) { transferStatus(error.message || '백업을 만들지 못했습니다.'); }
  });
  $('interest-import').addEventListener('click', () => $('interest-file').click());
  $('interest-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 65536) throw new Error('관심 목록 백업 파일이 아닙니다.');
      const data = await getData();
      const ids = validateBackup(JSON.parse(await file.text()), new Set(data.booths.map(booth => booth.id)));
      if (!window.confirm(`현재 관심 목록을 백업의 ${ids.length}개 부스로 바꿀까요?`)) return;
      localStorage.setItem(KEY, JSON.stringify(ids));
      location.reload();
    } catch (error) { transferStatus(error instanceof SyntaxError ? '백업 파일을 읽을 수 없습니다.' : error.message || '관심 목록을 불러오지 못했습니다.'); }
    finally { event.target.value = ''; }
  });
})();
