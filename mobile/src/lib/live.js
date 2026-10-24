/**
 * hook للبيانات اللايف: تحميل أوّل + stream + احتياطي بالـ polling.
 *
 *   const { data, status, refresh, setData } = useLive({
 *     path: '/me/stream', load: () => api.get('/me/tickets/active'),
 *   });
 *
 * صفحة المحل العامة بتفتح stream من غير حساب (`headers: publicHeaders`).
 * status: 'connecting' | 'live' | 'reconnecting'
 */
import { useCallback, useEffect, useState } from 'react';
import { getAccessToken, refreshSession } from './api.js';
import { openStream } from './stream.js';
import { useLatest } from './hooks.js';

/** ترويسة الزبون: التوكن الحالي، أو تجديد الجلسة لو مفيش */
export async function customerHeaders() {
  let token = getAccessToken();
  if (!token) token = (await refreshSession())?.tokens?.access_token ?? null;
  return token ? { Authorization: `Bearer ${token}` } : null;
}

export const publicHeaders = async () => ({});

export function useLive({ path, load, headers = customerHeaders, enabled = true }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState(null);
  const loadRef = useLatest(load);
  const headersRef = useLatest(headers);

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

  // التحميل الأوّل دايمًا، حتى لو مفيش stream (دور خلص مثلًا)
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!enabled || !path) return undefined;
    return openStream(path, {
      headers: () => headersRef.current(),
      onData: (next) => { setData(next); setError(null); },
      onStatus: setStatus,
      poll: refresh,
    });
  }, [path, enabled, refresh, headersRef]);

  return { data, status, error, refresh, setData };
}
