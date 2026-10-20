'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');

/** 実行中・直近のリサーチジョブ（メモリ保持）。イベントはバッファされ、後から接続したクライアントにも再生される。 */
const jobs = new Map();
const RETAIN_MS = 30 * 60 * 1000;

function formatJobErrorMessage(err) {
  const msg = String((err && err.message) || '');
  const code = String((err && err.code) || (err && err.cause && err.cause.code) || '').toUpperCase();
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || msg.includes('Connect Timeout Error') || msg.includes('fetch failed')) {
    return 'Google Gemini APIへの接続がタイムアウトしました。通信環境が不安定か、回線の一時的な遅延の可能性があります。再度お試しください。';
  }
  return msg || 'リサーチ処理中に予期せぬエラーが発生しました';
}

function createJob(params, runner, { onResult } = {}) {
  const id = crypto.randomUUID();
  const job = {
    id,
    params,
    status: 'running',
    events: [],
    emitter: new EventEmitter(),
    controller: new AbortController(),
    createdAt: Date.now(),
  };
  job.emitter.setMaxListeners(20);
  job.emit = (evt) => {
    const e = { ...evt, ts: Date.now() };
    job.events.push(e);
    job.emitter.emit('event', e);

    // 進行状況をリアルタイムにコンソールへ出力（デバッグ・進捗可視化）
    if (evt.type === 'log') {
      const icon = evt.kind === 'error' ? '❌' : evt.kind === 'warn' ? '⚠️' : evt.kind === 'done' ? '✅' : 'ℹ️';
      console.log(`[リサーチ] ${icon} ${evt.message}${evt.detail ? ` (${evt.detail})` : ''}`);
    } else if (evt.type === 'progress') {
      console.log(`[リサーチ進捗 ${evt.value}%] ${evt.stage || ''}`);
    } else if (evt.type === 'error') {
      console.error(`[リサーチエラー] ${evt.message}`);
    }
  };
  jobs.set(id, job);

  setImmediate(async () => {
    try {
      const result = await runner(job);
      job.status = 'done';
      if (onResult) {
        try {
          onResult(result);
        } catch (e) {
          console.error('[history] 保存に失敗:', e.message);
        }
      }
      job.emit({ type: 'result', data: result });
    } catch (e) {
      job.status = job.controller.signal.aborted ? 'cancelled' : 'error';
      if (job.status === 'error') console.error('[job]', e);
      const errMsg = job.status === 'cancelled' ? 'リサーチをキャンセルしました' : formatJobErrorMessage(e);
      job.emit({ type: 'error', message: errMsg });
    } finally {
      job.emit({ type: 'end', status: job.status });
      setTimeout(() => jobs.delete(id), RETAIN_MS).unref();
    }
  });
  return job;
}

const getJob = (id) => jobs.get(id);

module.exports = { createJob, getJob, formatJobErrorMessage };
