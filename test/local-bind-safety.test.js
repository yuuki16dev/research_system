'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const env = require('../server/env');

function findFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, host, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function getNonLoopbackIpv4() {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const entry of list || []) {
      if (entry.family === 'IPv4' && !entry.internal && entry.address) {
        return entry.address;
      }
    }
  }
  return null;
}

function canConnectTcp(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function spawnServer({ port, host }) {
  const childEnv = { ...process.env, PORT: String(port), NODE_ENV: 'test' };
  delete childEnv.SUPABASE_URL;
  delete childEnv.SUPABASE_ANON_KEY;
  delete childEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (host === undefined) {
    delete childEnv.HOST;
  } else {
    childEnv.HOST = host;
  }

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }

  if (!ready) {
    child.kill();
    throw new Error(`Server did not start on port ${port}.\nstdout: ${stdout}\nstderr: ${stderr}`);
  }

  return {
    child,
    baseUrl,
    getOutput: () => ({ stdout, stderr }),
    stop: async () => {
      if (child.exitCode === null) {
        child.kill();
        await new Promise((r) => child.once('exit', r));
      }
    },
  };
}

test('D-5 unit: resolveListenHost defaults to 127.0.0.1 locally and 0.0.0.0 in cloud', () => {
  assert.equal(env.resolveListenHost(undefined, false), '127.0.0.1');
  assert.equal(env.resolveListenHost('', false), '127.0.0.1');
  assert.equal(env.resolveListenHost('   ', false), '127.0.0.1');
  assert.equal(env.resolveListenHost(undefined, true), '0.0.0.0');
  assert.equal(env.resolveListenHost('', true), '0.0.0.0');
  assert.equal(env.resolveListenHost('0.0.0.0', false), '0.0.0.0');
  assert.equal(env.resolveListenHost('127.0.0.1', true), '127.0.0.1');

  assert.equal(env.isLoopbackHost('127.0.0.1'), true);
  assert.equal(env.isLoopbackHost('localhost'), true);
  assert.equal(env.isLoopbackHost('::1'), true);
  assert.equal(env.isLoopbackHost('0.0.0.0'), false);
  assert.equal(env.isLoopbackHost('192.168.1.10'), false);
});

test('D-5 integration: default local launch binds 127.0.0.1 only and rejects LAN IP connections', async () => {
  const port = await findFreePort('127.0.0.1');
  const srv = await spawnServer({ port, host: undefined });
  try {
    const res = await fetch(`${srv.baseUrl}/api/info`);
    assert.equal(res.status, 200);
    const info = await res.json();
    assert.equal(info.host, '127.0.0.1');
    assert.deepEqual(info.lan, []);

    const { stdout } = srv.getOutput();
    assert.ok(stdout.includes('127.0.0.1'), 'startup banner should display 127.0.0.1');
    assert.ok(stdout.includes('HOST=0.0.0.0'), 'startup banner should hint HOST=0.0.0.0 for LAN');

    const lanIp = getNonLoopbackIpv4();
    if (lanIp) {
      const reachableViaLan = await canConnectTcp(lanIp, port, 1200);
      assert.equal(reachableViaLan, false, `LAN IP ${lanIp}:${port} must NOT accept connections by default`);
    }
  } finally {
    await srv.stop();
  }
});

test('D-5 integration: explicit HOST=0.0.0.0 enables LAN listening when requested', async () => {
  const port = await findFreePort('0.0.0.0');
  const srv = await spawnServer({ port, host: '0.0.0.0' });
  try {
    const res = await fetch(`${srv.baseUrl}/api/info`);
    assert.equal(res.status, 200);
    const info = await res.json();
    assert.equal(info.host, '0.0.0.0');
    assert.ok(Array.isArray(info.lan));

    const lanIp = getNonLoopbackIpv4();
    if (lanIp) {
      const lanRes = await fetch(`http://${lanIp}:${port}/api/health`);
      assert.equal(lanRes.status, 200, `LAN IP ${lanIp}:${port} should respond when HOST=0.0.0.0`);
    }
  } finally {
    await srv.stop();
  }
});

test('D-5 distribution & docs: .dockerignore, Dockerfile, README, and user guide reflect D-5 policy', () => {
  const dockerignore = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8');
  for (const entry of ['data', 'docs', 'test', 'templates/*.pdf']) {
    assert.ok(
      dockerignore.split(/\r?\n/).some((line) => line.trim() === entry),
      `.dockerignore must include "${entry}"`
    );
  }

  const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  assert.ok(dockerfile.includes('HOST=0.0.0.0'), 'Dockerfile must set HOST=0.0.0.0 for container networking');

  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.ok(!readme.includes('外部サーバーへの情報送信はありません'), 'README must not claim zero external transmission');
  assert.ok(readme.includes('HOST=0.0.0.0'), 'README must document HOST=0.0.0.0 for smartphone LAN access');
  assert.ok(readme.includes('Google Gemini') && readme.includes('Tavily'), 'README must describe Gemini & Tavily transmission');

  const guide = fs.readFileSync(path.join(ROOT, 'はじめにお読みください.txt'), 'utf8');
  assert.ok(
    !guide.includes('外部のクラウドや第三者サーバーへデータが送信されることは一切ありません'),
    'はじめにお読みください.txt must not claim zero external transmission'
  );
  assert.ok(guide.includes('HOST=0.0.0.0'), 'はじめにお読みください.txt must document HOST=0.0.0.0');
  assert.ok(guide.includes('Google Gemini') && guide.includes('Tavily'), 'はじめにお読みください.txt must mention Gemini & Tavily');
});
