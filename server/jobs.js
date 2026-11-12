'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');

/** 実行中・直近のリサーチジョブ（メモリ保持）。イベントはバッファされ、後から接続したクライアントにも再生される。 */
const jobs = new Map();
const RETAIN_MS = 30 * 60 * 1000;

// 未決定: サーバー全体の最大同時実行ジョブ数（仮の値: 3）
const DEFAULT_MAX_CONCURRENT_JOBS = 3;

function getMaxConcurrentJobs() {
  const parsed = parseInt(process.env.MAX_CONCURRENT_JOBS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONCURRENT_JOBS;
}

function getRunningJobCount() {
  let count = 0;
  for (const job of jobs.values()) {
    if (job.status === 'running' && !job.controller.signal.aborted) {
      count++;
    }
  }
  return count;
}

function hasRunningJobForUser(userId) {
  if (!userId) return false;
  for (const job of jobs.values()) {
    if (job.userId === userId && job.status === 'running' && !job.controller.signal.aborted) {
      return true;
    }
  }
  return false;
}

function checkJobCapacity(userId) {
  if (getRunningJobCount() >= getMaxConcurrentJobs()) {
    return {
      ok: false,
      status: 503,
      error: '現在サーバーが混雑しています。しばらく経ってから再度お試しください。',
      code: 'SERVER_BUSY',
    };
  }
  if (userId && hasRunningJobForUser(userId)) {
    return {
      ok: false,
      status: 429,
      error: '現在実行中のリサーチジョブがあります。完了をお待ちいただくか、キャンセルしてください。',
      code: 'JOB_ALREADY_RUNNING',
    };
  }
  return { ok: true };
}

function formatJobErrorMessage(err) {
  const msg = String((err && err.message) || '');
  const code = String((err && err.code) || (err && err.cause && err.cause.code) || '').toUpperCase();
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || msg.includes('Connect Timeout Error') || msg.includes('fetch failed')) {
    return 'Google Gemini APIへの接続がタイムアウトしました。通信環境が不安定か、回線の一時的な遅延の可能性があります。再度お試しください。';
  }
  return msg || 'リサーチ処理中に予期せぬエラーが発生しました';
}

function createJob(params, runner, { onResult, userId } = {}) {
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(24).toString('base64url');
  const jobUserId = userId || (params && params.userId) || null;
  const job = {
    id,
    userId: jobUserId,
    token, // 短命の購読用トークン
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

function _clearJobsForTest() {
  jobs.clear();
}

module.exports = {
  createJob,
  getJob,
  formatJobErrorMessage,
  hasRunningJobForUser,
  getRunningJobCount,
  getMaxConcurrentJobs,
  checkJobCapacity,
  _clearJobsForTest,
};
