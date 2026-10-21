// ==========================================================================
// API クライアント
// ==========================================================================

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

export const api = {
  info: () => request('GET', '/api/info'),
  getSettings: () => request('GET', '/api/settings'),
  saveSettings: (patch) => request('PUT', '/api/settings', patch),
  testSettings: (body) => request('POST', '/api/settings/test', body),
  startResearch: (params) => request('POST', '/api/research', params),
  cancelResearch: (id) => request('POST', `/api/research/${id}/cancel`),
  history: () => request('GET', '/api/history'),
  historyItem: (id) => request('GET', `/api/history/${id}`),
  deleteHistory: (id) => request('DELETE', `/api/history/${id}`),
  patchHistory: (id, patch) => request('PATCH', `/api/history/${id}`, patch),
  deepDive: (body) => request('POST', '/api/research/deep-dive', body),
  usage: () => request('GET', '/api/usage'),
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
      if (e.type === 'end' || e.type === 'error') {
        closeConnection();
      }
      handlers.onEvent && handlers.onEvent(e);
    };

    es.onerror = () => {
      if (finished) return;
      // 接続が完全に切断された場合のみ1回だけ通知して閉じる
      if (es.readyState === EventSource.CLOSED) {
        closeConnection();
        handlers.onError && handlers.onError(new Error('サーバーとの接続が切断されました'));
      }
    };

    return () => {
      closeConnection();
    };
  },

};
