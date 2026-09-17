const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

const defaultRoot = path.resolve(__dirname, '../dist');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const versionPath = '/__tgs_dev/version';
const clientPath = '/__tgs_dev/client.js';

function isInside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

// Poll metadata so editor atomic saves and directory replacements are noticed.
function snapshot(directory) {
  const entries = [];
  function visit(current) {
    try {
      for (const entry of fs.readdirSync(current, {withFileTypes:true}).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(current, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.isFile()) {
          const stat = fs.statSync(file, {bigint:true});
          entries.push([path.relative(directory, file), String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)]);
        }
      }
    } catch (error) {
      // A file can disappear during an atomic save. The next pass settles it.
      entries.push([path.relative(directory, current), error.code]);
    }
  }
  visit(directory);
  return JSON.stringify(entries);
}

function createDevServer({root = defaultRoot, liveReload = true, pollIntervalMs = 500} = {}) {
  root = fs.realpathSync(root);
  const session = randomUUID();
  let revision = 0;
  let latestSnapshot = liveReload ? snapshot(root) : '';
  let pendingSnapshot = null;
  const getVersion = () => `${session}:${revision}`;
  const client = liveReload ? fs.readFileSync(path.join(__dirname, 'dev-client.js')) : null;

  const server = http.createServer((req, res) => {
    function send(status, body = '', contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
      const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
      res.writeHead(status, {
        'Content-Type':contentType,
        'Content-Length':data.length,
        'Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff',
        ...extraHeaders
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      send(405, 'Method not allowed', undefined, {Allow:'GET, HEAD'});
      return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { send(400, 'Bad request'); return; }
    if (pathname.includes('\0')) { send(400, 'Bad request'); return; }
    if (liveReload && pathname === versionPath) {
      send(200, JSON.stringify({version:getVersion()}), mime['.json']);
      return;
    }
    if (liveReload && pathname === clientPath) {
      send(200, client, mime['.js']);
      return;
    }
    if (pathname === '/') pathname = '/index.html';
    const file = path.resolve(root, '.' + pathname);
    if (!isInside(root, file)) { send(403, 'Forbidden'); return; }
    fs.realpath(file, (realpathError, resolved) => {
      if (realpathError) { send(404, 'Not found'); return; }
      // Junctions and symlinks inside dist must not expose other PC files.
      if (!isInside(root, resolved)) { send(403, 'Forbidden'); return; }
      fs.readFile(resolved, (error, data) => {
        if (error) { send(404, 'Not found'); return; }
        const extension = path.extname(file).toLowerCase();
        if (liveReload && extension === '.html') {
          const script = `<script src="${clientPath}" data-tgs-dev-version="${getVersion()}"></script>`;
          const html = data.toString('utf8');
          data = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, script + '\n</body>') : html + script;
        }
        send(200, data, mime[extension] || 'application/octet-stream');
      });
    });
  });

  if (liveReload) {
    const pollTimer = setInterval(() => {
      const nextSnapshot = snapshot(root);
      if (nextSnapshot === latestSnapshot) { pendingSnapshot = null; return; }
      if (nextSnapshot !== pendingSnapshot) { pendingSnapshot = nextSnapshot; return; }
      // Two matching scans let a batch save cause one refresh.
      latestSnapshot = nextSnapshot;
      pendingSnapshot = null;
      revision += 1;
    }, pollIntervalMs);
    pollTimer.unref();
    server.on('close', () => clearInterval(pollTimer));
  }
  return server;
}

function getLanAddresses() {
  return [...new Set(Object.values(os.networkInterfaces()).flat().filter(network =>
    network && (network.family === 'IPv4' || network.family === 4) && !network.internal &&
    !network.address.startsWith('169.254.')
  ).map(network => network.address))];
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--lan', '--no-reload'].includes(arg))) {
    console.error('Usage: node scripts/serve.cjs [--lan] [--no-reload]');
    process.exit(1);
  }
  const port = Number(process.env.PORT || 5173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('PORT must be an integer from 0 to 65535.');
    process.exit(1);
  }
  const lan = args.includes('--lan');
  const liveReload = !args.includes('--no-reload');
  const server = createDevServer({liveReload});
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE'
      ? `Port ${port} is already in use. Stop the earlier server first, or set PORT to another port.`
      : error.message);
    process.exitCode = 1;
  });
  server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
    const actualPort = server.address().port;
    console.log(`TGS map: http://127.0.0.1:${actualPort} (Ctrl+C to stop)`);
    if (lan) {
      const addresses = getLanAddresses();
      for (const address of addresses) console.log(`iPhone (same Wi-Fi): http://${address}:${actualPort}`);
      if (!addresses.length) console.log('No LAN IPv4 address found. Connect this PC to Wi-Fi or Ethernet.');
    }
    if (liveReload) console.log('Live reload: save a file in dist/ to refresh connected pages.');
  });
}

module.exports = {createDevServer, getLanAddresses};
