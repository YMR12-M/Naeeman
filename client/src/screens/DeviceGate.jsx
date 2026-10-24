/**
 * بوابة جهاز المحل: لو الجهاز مش مربوط، شاشة كود الربط (6 أرقام من المالك).
 * بعد الربط بتعرض الشاشة نفسها، ولو المالك لغى الجهاز بترجع لشاشة الربط.
 * شاشات الأجهزة دايمًا «بالنهار» (المحل منوّر) — docs/DESIGN_SYSTEM.md قسم 3.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { forgetDevice, pairDevice, readDevice } from '../lib/device.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { LeatherButton, Mirror, Sign, Wordmark } from '../components/brand/index.jsx';
import { Notice } from '../components/ui/index.js';

const DeviceContext = createContext(null);
export const useDevice = () => useContext(DeviceContext);

/** شاشات الأجهزة: نهار دايمًا، وأرضيتها الحيطة */
function useDeviceSurface() {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = 'light';
    root.classList.add('device-screen');
    const observer = new MutationObserver(() => { if (root.dataset.theme !== 'light') root.dataset.theme = 'light'; });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { observer.disconnect(); root.classList.remove('device-screen'); root.dataset.theme = previous; };
  }, []);
}

function PairingScreen({ type, label, onPaired }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError('الكود 6 أرقام'); return; }
    setBusy(true);
    setError(null);
    try {
      onPaired(await pairDevice(type, code));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="device-pairing">
      <Sign size="lg" aria-hidden="true"><Wordmark height="1.3em" /></Sign>
      <Mirror arch className="pair-mirror">
        <form className="stack" onSubmit={submit} noValidate>
          <h1 className="center">اربط {label}</h1>
          <p className="center muted">المالك يطلّع الكود من اللوحة: الأجهزة ← اربط جهاز</p>
          {error && <Notice tone="danger" icon="alert">{error}</Notice>}
          <input
            className="input pair-input" inputMode="numeric" autoComplete="one-time-code" autoFocus
            aria-label="كود الربط" maxLength={6} dir="ltr" value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <LeatherButton type="submit" block loading={busy}>اربط</LeatherButton>
        </form>
      </Mirror>
    </div>
  );
}

export default function DeviceGate({ type, label, children }) {
  useDocumentTitle(label);
  useDeviceSurface();
  const [device, setDevice] = useState(() => readDevice(type)?.device ?? null);

  const unpair = useCallback(() => {
    forgetDevice(type);
    setDevice(null);
  }, [type]);

  if (!device) return <PairingScreen type={type} label={label} onPaired={setDevice} />;
  return <DeviceContext.Provider value={{ device, unpair }}>{children}</DeviceContext.Provider>;
}
