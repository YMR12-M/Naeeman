import { useCallback, useEffect, useRef, useState } from 'react';

export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** حالة تُحفَظ في localStorage (وتعمل بدونه لو حُظر) */
export function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : JSON.parse(stored);
    } catch {
      return initial;
    }
  });
  const update = useCallback((next) => {
    setValue((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      try { window.localStorage.setItem(key, JSON.stringify(resolved)); } catch { /* وضع خاص */ }
      return resolved;
    });
  }, [key]);
  return [value, update];
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const handler = (event) => setMatches(event.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

/** يغلق عنصرًا منبثقًا عند الضغط خارجه أو على Esc (`extraRef`: جزء منه مرسوم في مكان تاني، زي قايمة في portal) */
export function useDismiss(ref, onDismiss, active = true, extraRef = null) {
  useEffect(() => {
    if (!active) return undefined;
    const inside = (target) => ref.current?.contains(target) || extraRef?.current?.contains(target);
    const onPointer = (event) => { if (ref.current && !inside(event.target)) onDismiss(); };
    const onKey = (event) => { if (event.key === 'Escape') onDismiss(); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, onDismiss, active, extraRef]);
}

export function useDocumentTitle(title) {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} — نعيمًا` : 'نعيمًا — لوحة المحل';
    return () => { document.title = previous; };
  }, [title]);
}

/** مرجع يحمل آخر قيمة (لاستعمالها داخل مؤقّتات بلا إعادة اشتراك) */
export function useLatest(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** ساعة بتدقّ كل `ms` (للعدّادات والوقت المتوقّع اللي بيقرّب) */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
