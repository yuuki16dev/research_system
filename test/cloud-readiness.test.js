'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

test('cloud readiness: Dockerfile exists and configures node 20, chromium, and healthcheck', () => {
  const dockerfilePath = path.join(ROOT, 'Dockerfile');
  assert.ok(fs.existsSync(dockerfilePath), 'Dockerfile must exist');
  const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');

  assert.ok(dockerfile.includes('node:20'), 'Dockerfile must use node:20');
  assert.ok(dockerfile.includes('chromium'), 'Dockerfile must install chromium');
  assert.ok(dockerfile.includes('fonts-noto-cjk'), 'Dockerfile must install CJK fonts');
  assert.ok(dockerfile.includes('/api/health'), 'Dockerfile must include healthcheck to /api/health');
});

test('cloud readiness: render.yaml exists and defines docker web service', () => {
  const renderYamlPath = path.join(ROOT, 'render.yaml');
  assert.ok(fs.existsSync(renderYamlPath), 'render.yaml must exist');
  const yaml = fs.readFileSync(renderYamlPath, 'utf8');

  assert.ok(yaml.includes('type: web'), 'render.yaml must define a web service');
  assert.ok(yaml.includes('env: docker'), 'render.yaml must use docker env');
  assert.ok(yaml.includes('plan: starter'), 'render.yaml should default to starter plan');
  assert.ok(yaml.includes('healthCheckPath: /api/health'), 'render.yaml must configure healthCheckPath');
});

test('cloud readiness: pdf.js supports CHROME_PATH environment variable and sandbox flags', () => {
  const pdfJsPath = path.join(ROOT, 'server', 'pdf.js');
  const pdfJs = fs.readFileSync(pdfJsPath, 'utf8');

  assert.ok(pdfJs.includes('process.env.CHROME_PATH'), 'pdf.js must check process.env.CHROME_PATH');
  assert.ok(pdfJs.includes('--no-sandbox'), 'pdf.js must include --no-sandbox for container compatibility');
  assert.ok(pdfJs.includes('--disable-dev-shm-usage'), 'pdf.js must include --disable-dev-shm-usage');
});

test('cloud readiness: server/index.js registers /api/health endpoint', () => {
  const indexJsPath = path.join(ROOT, 'server', 'index.js');
  const indexJs = fs.readFileSync(indexJsPath, 'utf8');

  assert.ok(indexJs.includes("app.get('/api/health'"), 'server/index.js must register /api/health');
});

