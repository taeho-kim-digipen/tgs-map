const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { setTimeout: delay } = require('node:timers/promises');
const { createDevServer } = require('../scripts/serve.cjs');

function request(server, url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: server.address().port,
      path: url, method, agent: false,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        bytes: Buffer.concat(chunks),
      }));
      res.on('error', reject);
    });
    req.setTimeout(3000, () => req.destroy(new Error(`Request timed out: ${url}`)));
    req.on('error', reject);
    req.end();
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

async function close(server) {
  if (server?.listening) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function version(server) {
  const response = await request(server, '/__tgs_dev/version');
  assert.equal(response.status, 200, 'version endpoint is available in development');
  assert.match(response.headers['cache-control'], /no-store/, 'version response bypasses cache');
  const value = JSON.parse(response.body).version;
  assert.equal(typeof value, 'string');
  assert.ok(value.length > 0, 'revision includes a nonempty server identity');
  return value;
}

async function changedVersion(server, previous) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const current = await version(server);
    if (current !== previous) return current;
    await delay(25);
  }
  assert.fail('Editing a file must change the development revision within three seconds');
}

async function checkClientRecovery(code, initialVersion, restartedVersion) {
  class Element {
    constructor() { this.style = {}; this.dataset = {}; this.children = []; this.listeners = {}; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.append(node); }
    attachShadow() { this.shadow = new Element(); return this.shadow; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
  }
  const viewport = new Element();
  const documentEvents = {};
  const windowEvents = {};
  const intervalChecks = [];
  const timeouts = new Map();
  let timeoutId = 0;
  let responseVersion = initialVersion;
  let networkFailure = false;
  let requests = 0;
  let reloads = 0;
  const document = {
    currentScript: { dataset: { tgsDevVersion: initialVersion } },
    hidden: false,
    body: new Element(),
    createElement: () => new Element(),
    getElementById: (id) => id === 'viewport' ? viewport : null,
    addEventListener: (name, listener) => { documentEvents[name] = listener; },
  };
  const context = {
    document,
    window: { addEventListener: (name, listener) => { windowEvents[name] = listener; } },
    sessionStorage: { getItem: () => null, setItem() {} },
    location: { reload() { reloads++; } },
    AbortController,
    setInterval: (callback) => { intervalChecks.push(callback); return intervalChecks.length; },
    setTimeout: (callback) => { const id = ++timeoutId; timeouts.set(id, callback); return id; },
    clearTimeout: (id) => timeouts.delete(id),
    fetch: async (url, options) => {
      requests++;
      assert.equal(url, '/__tgs_dev/version');
      assert.equal(options.cache, 'no-store', 'client revision requests bypass browser caches');
      if (networkFailure) throw new Error('Simulated disconnected Wi-Fi');
      return { ok: true, json: async () => ({ version: responseVersion }) };
    },
  };
  const settled = () => new Promise(setImmediate);
  vm.runInNewContext(code, context, { filename: 'served-dev-client.js' });
  await settled();
  assert.equal(requests, 1, 'client checks for edits when opened');
  assert.equal(reloads, 0, 'matching page and server revisions do not reload');
  assert.equal(intervalChecks.length, 1, 'client keeps polling for edits');
  const statusButton = viewport.children[0].shadow.children[1];
  assert.equal(statusButton.dataset.offline, 'false', 'connection success is visible');
  assert.equal(timeouts.size, 0, 'successful requests clear their timeout');

  networkFailure = true;
  intervalChecks[0]();
  await settled();
  assert.equal(requests, 2, 'polling checks again after the initial connection');
  assert.equal(reloads, 0, 'lost Wi-Fi does not cause a reload loop');
  assert.equal(statusButton.dataset.offline, 'true', 'lost server connection is visible');
  assert.equal(timeouts.size, 0, 'failed requests also clear their timeout');
  networkFailure = false;
  windowEvents.online();
  await settled();
  assert.equal(requests, 3, 'online event retries a failed connection');
  assert.equal(statusButton.dataset.offline, 'false');
  assert.equal(reloads, 0, 'reconnecting to the same revision preserves the page');

  document.hidden = true;
  responseVersion = restartedVersion;
  intervalChecks[0]();
  await settled();
  assert.equal(requests, 3, 'hidden tabs pause polling');
  document.hidden = false;
  documentEvents.visibilitychange();
  await settled();
  assert.equal(reloads, 1, 'returning to a tab reloads edits made during a server restart');
  intervalChecks[0]();
  windowEvents.pageshow();
  windowEvents.focus();
  await settled();
  assert.equal(reloads, 1, 'overlapping foreground events do not trigger repeated reloads');
}

(async () => {
  const temporaryParent = fs.realpathSync(os.tmpdir());
  const temporary = fs.mkdtempSync(path.join(temporaryParent, 'tgs-server-test-'));
  const root = path.join(temporary, 'dist');
  const sibling = path.join(temporary, 'dist-neighbor');
  fs.mkdirSync(root);
  fs.mkdirSync(sibling);
  fs.mkdirSync(path.join(root, 'nested'));
  const originalHtml = '<!doctype html><html><head><title>지도</title></head><body>test map</body></html>\n';
  const originalJs = 'window.testMap = "unchanged";\n';
  const originalBinary = Buffer.from([0, 128, 255, 10, 13, 60, 62]);
  fs.writeFileSync(path.join(root, 'index.html'), originalHtml);
  fs.writeFileSync(path.join(root, 'nested', 'page.html'), originalHtml);
  fs.writeFileSync(path.join(root, 'app.js'), originalJs);
  fs.writeFileSync(path.join(root, 'image.png'), originalBinary);
  fs.writeFileSync(path.join(temporary, 'secret.txt'), 'outside-private-file');
  fs.writeFileSync(path.join(sibling, 'secret.txt'), 'outside-private-file');
  let server;
  let staticServer;
  try {
    server = await listen(createDevServer({ root, liveReload: true, pollIntervalMs: 20 }));
    const initialVersion = await version(server);
    const page = await request(server, '/');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /^text\/html/);
    assert.match(page.headers['cache-control'], /no-store/);
    assert.equal(Number(page.headers['content-length']), page.bytes.length, 'HTML byte length includes injected client');
    assert.match(page.body, /<script[^>]+src=["']\/__tgs_dev\/client\.js["']/);
    assert.ok(page.body.includes(initialVersion), 'HTML carries the revision it was served with');
    assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), originalHtml, 'reload injection leaves source HTML untouched');
    const nested = await request(server, '/nested/page.html');
    assert.equal(nested.status, 200);
    assert.match(nested.body, /\/__tgs_dev\/client\.js/, 'nested HTML also receives the development client');

    const head = await request(server, '/', 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body, '', 'HEAD returns no body');
    assert.equal(head.headers['content-length'], page.headers['content-length'], 'HEAD describes the GET representation');
    assert.equal(head.headers['content-type'], page.headers['content-type']);
    const js = await request(server, '/app.js?revision=ignored');
    assert.equal(js.status, 200);
    assert.equal(js.body, originalJs, 'ordinary JavaScript is served without injection');
    const binary = await request(server, '/image.png');
    assert.equal(binary.status, 200);
    assert.deepEqual(binary.bytes, originalBinary, 'binary resources are served unchanged');
    const client = await request(server, '/__tgs_dev/client.js');
    assert.equal(client.status, 200);
    assert.match(client.headers['content-type'], /(?:java|ecma)script/);
    assert.ok(client.body.length > 0);
    assert.equal((await request(server, '/', 'POST')).status, 405, 'development server only accepts read requests');
    assert.equal((await request(server, '/missing-file.svg')).status, 404);
    assert.equal((await request(server, '/nested')).status, 404, 'directories are not listed');
    assert.equal((await request(server, '/%E0%A4%A')).status, 400, 'malformed escapes are rejected');
    for (const url of [
      '/%2e%2e%2fsecret.txt',
      '/..%5csecret.txt',
      '/%2e%2e%2fdist-neighbor%2fsecret.txt',
      '/secret.txt',
      '/%00',
    ]) {
      const response = await request(server, url);
      assert.ok([400, 403, 404].includes(response.status), `invalid or outside-root path is blocked: ${url}`);
      assert.ok(!response.body.includes('outside-private-file'), `outside file is never exposed: ${url}`);
    }
    fs.symlinkSync(sibling, path.join(root, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
    const linkedFile = await request(server, '/outside-link/secret.txt');
    assert.ok([403, 404].includes(linkedFile.status), 'a junction or symlink cannot expose files outside the root');
    assert.ok(!linkedFile.body.includes('outside-private-file'));

    // Account for the link creation before testing a stable, unchanged revision.
    await delay(75);
    const stableVersion = await version(server);
    await delay(75);
    assert.equal(await version(server), stableVersion, 'unchanged files do not cause reload loops');
    fs.writeFileSync(path.join(root, 'app.js'), `${originalJs}// an actual development edit\n`);
    const editVersion = await changedVersion(server, stableVersion);
    assert.match((await request(server, '/app.js')).body, /an actual development edit/);
    const refreshedPage = await request(server, '/');
    assert.ok(refreshedPage.body.includes(editVersion), 'new pages embed the updated revision');
    fs.writeFileSync(path.join(root, 'nested', 'new.css'), 'body { color: blue; }');
    const createVersion = await changedVersion(server, editVersion);
    fs.unlinkSync(path.join(root, 'nested', 'new.css'));
    const deleteVersion = await changedVersion(server, createVersion);
    assert.equal((await request(server, '/nested/new.css')).status, 404, 'deleted assets return 404');

    await close(server);
    server = await listen(createDevServer({ root, liveReload: true, pollIntervalMs: 20 }));
    const restartedVersion = await version(server);
    assert.notEqual(restartedVersion, deleteVersion, 'server restart produces a different revision for existing clients');
    assert.notEqual(restartedVersion, initialVersion, 'restart identity does not reset to the previous initial revision');
    await checkClientRecovery(client.body, initialVersion, restartedVersion);

    staticServer = await listen(createDevServer({ root, liveReload: false }));
    const staticPage = await request(staticServer, '/');
    assert.equal(staticPage.status, 200);
    assert.equal(staticPage.body, originalHtml, 'normal static serving never injects development code');
    assert.equal((await request(staticServer, '/__tgs_dev/version')).status, 404);
    assert.equal((await request(staticServer, '/__tgs_dev/client.js')).status, 404);
    assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), originalHtml);
    console.log('Development server checks passed: HTTP/HEAD, path isolation, response-only injection, asset changes, restart revisions, client reconnection, and static mode.');
  } finally {
    await close(staticServer);
    await close(server);
    // Delete only the exact disposable directory created above, never the project dist.
    const resolvedTemporary = fs.realpathSync(temporary);
    assert.equal(path.dirname(resolvedTemporary), temporaryParent);
    assert.ok(path.basename(resolvedTemporary).startsWith('tgs-server-test-'));
    fs.rmSync(resolvedTemporary, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
