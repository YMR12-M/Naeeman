/**
 * hook للبيانات اللايف: تحميل أوّل + stream + احتياطي بالـ polling.
 *
 *   const { data, status, refresh } = useLive({
 *     path: '/queue/stream', load: () => api.get('/queue'), headers: staffHeaders,
 *   });
 *
 * status: 'connecting' | 'live' | 'reconnecting'
 */
import { useCallback, useEffect, useState } from 'react';
import { getAccessToken, refreshSession } from './api.js';
import { openStream } from './stream.js';
import { useLatest } from './hooks.js';

/** ترويسة الموظف: التوكن الحالي، أو تجديد الجلسة لو مفيش */
export async function staffHeaders() {
  let token = getAccessToken();
  if (!token) token = (await refreshSession())?.tokens?.access_token ?? null;
  return token ? { Authorization: `Bearer ${token}` } : null;
}

export function useLive({ path, load, headers = staffHeaders, enabled = true, onFatal }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState(null);
  const loadRef = useLatest(load);
  const headersRef = useLatest(headers);
  const fatalRef = useLatest(onFatal);

  const refresh = useCallback(async () => {
    try {
      const next = await loadRef.current();
      setData(next);
      setError(null);
      return next;
    } catch (failure) {
      setError(failure);
      return null;
    }
  }, [loadRef]);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    return openStream(path, {
      headers: () => headersRef.current(),
      onData: (next) => { setData(next); setError(null); },
      onStatus: setStatus,
      poll: refresh,
      onFatal: (failure) => fatalRef.current?.(failure),
    });
  }, [path, enabled, refresh, headersRef, fatalRef]);

  return { data, status, error, refresh, setData };
}
