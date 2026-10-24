/**
 * حالة المستخدم الحالي.
 *
 * عند التحميل نحاول تجديد الجلسة من كوكي/جسر الديسكتوب: لو نجح فالمستخدم
 * مسجَّل (لا نحفظ التوكن في أي مكان دائم)، وإلا نعرض شاشة الدخول.
 * انتهاء الجلسة نهائيًّا (توكن مسروق/ملغى) يُخرج المستخدم فورًا.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, endSession, onSessionExpired, refreshSession, startSession } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState({ status: 'loading', user: null });

  useEffect(() => {
    let alive = true;
    refreshSession().then((session) => {
      if (!alive) return;
      setState(session ? { status: 'authenticated', user: session.user } : { status: 'anonymous', user: null });
    });
    const off = onSessionExpired(() => {
      queryClient.clear();
      setState({ status: 'anonymous', user: null });
    });
    return () => { alive = false; off(); };
  }, [queryClient]);

  const login = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password }, { auth: false });
    await startSession(data);
    setState({ status: 'authenticated', user: data.user });
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout', {}); } catch { /* نخرج محليًّا في كل الأحوال */ }
    await endSession();
    queryClient.clear();
    setState({ status: 'anonymous', user: null });
  }, [queryClient]);

  /** بعد تعديل الملف الشخصي أو بيانات المحل: نعيد جلب المستخدم */
  const reloadUser = useCallback(async () => {
    const user = await api.get('/auth/me');
    setState({ status: 'authenticated', user });
    return user;
  }, []);

  /** بعد تغيير كلمة المرور: السيرفر يفتح جلسة جديدة */
  const adoptSession = useCallback(async (data) => {
    await startSession(data);
    setState({ status: 'authenticated', user: data.user });
  }, []);

  const can = useCallback((permission) => Boolean(state.user?.permissions?.includes(permission)), [state.user]);

  const value = useMemo(
    () => ({ ...state, login, logout, reloadUser, adoptSession, can }),
    [state, login, logout, reloadUser, adoptSession, can],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth خارج AuthProvider');
  return context;
};
