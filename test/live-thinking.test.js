'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const cssPath = path.join(ROOT, 'public', 'css', 'styles.css');
const jsPath = path.join(ROOT, 'public', 'js', 'modules', 'research.js');

test('live thinking: css enforces complete animation halt upon completion (.is-done)', () => {
  const css = fs.readFileSync(cssPath, 'utf8');

  // 1. Thinking card dot and orb spin must have animation: none on is-done
  assert.ok(css.includes('.live-thinking-card.is-done .lt-pulse-dot'), 'Must define is-done for pulse dot');
  assert.ok(css.includes('.live-thinking-card.is-done .lt-orb-ring'), 'Must define is-done for orb ring');
  assert.ok(css.includes('.live-thinking-card.is-done .lt-orb-stream::after'), 'Must define checkmark for orb stream');

  // 2. Progress fill shimmer and reassurance pulse must also halt on is-done
  assert.ok(css.includes('.progress-panel.is-done .progress-fill'), 'Progress fill must halt shimmer on is-done');
  assert.ok(css.includes('.progress-panel.is-done .reassurance-pulse'), 'Reassurance pulse must halt on is-done');
});

test('live thinking: css enforces complete animation halt upon error or cancel (.is-error)', () => {
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.ok(css.includes('.live-thinking-card.is-error .lt-pulse-dot'), 'Must define is-error for pulse dot');
  assert.ok(css.includes('.live-thinking-card.is-error .lt-orb-ring'), 'Must define is-error for orb ring');
  assert.ok(css.includes('.progress-panel.is-error .reassurance-pulse'), 'Reassurance pulse must halt on is-error');
});

test('live thinking: research.js exports setLiveThinkingState and integrates into lifecycle handlers', () => {
  const js = fs.readFileSync(jsPath, 'utf8');

  assert.ok(js.includes('export function setLiveThinkingState'), 'research.js must export setLiveThinkingState');
  assert.ok(js.includes("setLiveThinkingState('done')"), 'finishSuccess must call setLiveThinkingState(done)');
  assert.ok(js.includes("setLiveThinkingState('aborted')"), 'handleAborted must call setLiveThinkingState(aborted)');
  assert.ok(js.includes("setLiveThinkingState('error'"), 'finishError must call setLiveThinkingState(error)');
  assert.ok(js.includes("setLiveThinkingState('running'"), 'startResearch must call setLiveThinkingState(running)');
});

test('live thinking: prevents race condition where late SSE logs revert completed card', () => {
  const js = fs.readFileSync(jsPath, 'utf8');

  // Verify that onEvent(log) guards against isFinishing or is-done card state
  assert.ok(js.includes('if (appState.isFinishing) return;'), 'log event handler must ignore incoming logs when isFinishing');
  assert.ok(js.includes("card.classList.contains('is-done')"), 'thinking log must not mutate card if already marked is-done');
  assert.ok(js.includes("if (appState.isFinishing || card.classList.contains('is-done')) return;"), 'setLiveThinkingState(running) must reject execution after finish');
});

