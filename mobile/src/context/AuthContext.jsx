/**
 * حالة الزبون الحالي.
 *
 * عند الفتح بنحاول نجدّد الجلسة من الكوكي: لو نجح الزبون داخل (التوكن في
 * الذاكرة بس)، وإلا الصفحات اللي محتاجة حساب بتوديه للدخول وترجّعه بعده.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, endSession, onSessionExpired, refreshSession, startSession } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState({ status: 'loading', customer: null });

  useEffect(() => {
    let alive = true;
    refreshSession().then((session) => {
      if (!alive) return;
      setState(session ? { status: 'authenticated', customer: session.customer } : { status: 'anonymous', customer: null });
    });
    const off = onSessionExpired(() => {
      queryClient.clear();
      setState({ status: 'anonymous', customer: null });
    });
    return () => { alive = false; off(); };
  }, [queryClient]);

  const adopt = useCallback((data) => {
    startSession(data);
    setState({ status: 'authenticated', customer: data.customer });
    return data.customer;
  }, []);

  const login = useCallback(async (phone, password) => adopt(await api.post('/customer-auth/login', { phone, password }, { auth: false })), [adopt]);
  const register = useCallback(async (body) => adopt(await api.post('/customer-auth/register', body, { auth: false })), [adopt]);

  const logout = useCallback(async () => {
    try { await api.post('/customer-auth/logout', {}); } catch { /* نخرج محليًّا في كل الأحوال */ }
    endSession();
    queryClient.clear();
    setState({ status: 'anonymous', customer: null });
  }, [queryClient]);

  /** بعد تعديل الاسم أو البريد */
  const setCustomer = useCallback((customer) => setState({ status: 'authenticated', customer }), []);

  const value = useMemo(
    () => ({ ...state, login, register, logout, adopt, setCustomer }),
    [state, login, register, logout, adopt, setCustomer],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth خارج AuthProvider');
  return context;
};
