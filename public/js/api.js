// ==========================================================================
// API クライアント
// ==========================================================================

async function request(method, url, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  try {
    const token = localStorage.getItem('rs_auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch {}

  const res = await fetch(url, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  info: () => request('GET', '/api/info'),
  authConfig: () => request('GET', '/api/auth/config'),
  authMe: () => request('GET', '/api/auth/me'),
  signup: (body) => request('POST', '/api/auth/signup', body),
  login: (body) => request('POST', '/api/auth/login', body),
  getSettings: () => request('GET', '/api/settings'),
  saveSettings: (patch) => request('PUT', '/api/settings', patch),
  testSettings: (body) => request('POST', '/api/settings/test', body),
  startResearch: (params) => request('POST', '/api/research', params),
  crossSynthesize: (reportIds) => request('POST', '/api/research/cross-synthesis', { reportIds }),
  startDeltaTracking: (baseReportId) => request('POST', '/api/research/delta', { baseReportId }),
  cancelResearch: (id) => request('POST', `/api/research/${id}/cancel`),
  history: () => request('GET', '/api/history'),
  historyItem: (id) => request('GET', `/api/history/${id}`),
  deleteHistory: (id) => request('DELETE', `/api/history/${id}`),
  patchHistory: (id, patch) => request('PATCH', `/api/history/${id}`, patch),
  updateHistory: (id, data) => request('PUT', `/api/history/${id}`, data),
  pinHistory: (id) => request('POST', `/api/history/${id}/pin`),
  checkVersion: () => request('GET', '/api/version/check'),
  changelog: () => request('GET', '/api/changelog'),
  deepDive: (body) => request('POST', '/api/research/deep-dive', body),
  usage: (options = {}) => request('GET', options.refresh ? '/api/usage?refresh=1' : '/api/usage'),
  getLogs: () => request('GET', '/api/logs'),
  shutdown: () => request('POST', '/api/shutdown'),
  qrUrl: (text) => `/api/qr?text=${encodeURIComponent(text)}`,

  /**
   * SSE で進捗を購読する。
   * @returns {() => void} 購読解除関数
   */
  subscribe(jobId, handlers) {
    const es = new EventSource(`/api/research/${jobId}/events`);
    let finished = false;
    let hasResult = false;

    const closeConnection = () => {
      if (finished) return;
      finished = true;
      try {
        es.close();
      } catch {}
    };

    es.onmessage = (m) => {
      if (finished) return;
      let e;
      try {
        e = JSON.parse(m.data);
      } catch {
        return;
      }

      if (e.type === 'result') {
        hasResult = true;
      }
      if (e.type === 'end' || e.type === 'error') {
        closeConnection();
      }
      handlers.onEvent && handlers.onEvent(e);

      // result 受信後は正常終了とみなして速やかに接続を閉じる（TCPクローズによる誤ったonerror発火を完全防止）
      if (e.type === 'result') {
        setTimeout(closeConnection, 100);
      }
    };

    es.onerror = async () => {
      if (finished || hasResult) return;

      // 接続が切断された場合
      if (es.readyState === EventSource.CLOSED) {
        closeConnection();

        // サーバー側で完了して履歴に保存されている可能性があるためフォールバック確認
        try {
          const recent = await api.getHistory();
          const matched = Array.isArray(recent) ? recent.find((h) => h.id === jobId) : null;
          if (matched) {
            const fullReport = await api.getHistoryItem(jobId);
            if (fullReport) {
              handlers.onEvent && handlers.onEvent({ type: 'result', data: fullReport });
              handlers.onEvent && handlers.onEvent({ type: 'end', status: 'done' });
              return;
            }
          }
        } catch {
          // フォールバック失敗時は通常エラーへ
        }

        handlers.onError && handlers.onError(new Error('サーバーとの接続が切断されました'));
      }
    };

    return () => {
      closeConnection();
    };
  },

};
