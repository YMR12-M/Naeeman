/**
 * «فعّل الإشعارات» بعد أخد الدور: من غيرها الزبون لازم يفضل فاتح التطبيق.
 * على الآيفون لازم التطبيق يتثبّت على الشاشة الرئيسية الأوّل، فبنشرح إزاي.
 */
import { useState } from 'react';
import { enablePush, pushState } from '../lib/push.js';
import { Icon } from '../lib/icons.jsx';
import { Mirror } from './brand/index.jsx';
import { Button, Notice } from './ui/index.js';

export default function PushPrompt({ compact = false }) {
  const [state, setState] = useState(() => pushState());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (state === 'granted' || (compact && state !== 'default')) return null;

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      setState(await enablePush());
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Mirror thin className="stack push-prompt">
      <div className="row tight"><Icon name="bell" size={20} /><span className="bold">نبّهك لما دورك يقرّب؟</span></div>
      {state === 'install-first' && (
        <p className="small">
          على الآيفون: دوس <span className="bold">مشاركة</span> <Icon name="upload" size={14} /> تحت، وبعدين
          {' '}<span className="bold">«إضافة إلى الشاشة الرئيسية»</span>، وافتح «نعيمًا» من هناك وفعّل الإشعارات.
        </p>
      )}
      {state === 'unsupported' && <p className="small muted">المتصفّح ده مش بيدعم الإشعارات. سيب الصفحة دي مفتوحة وهي هتتحدّث لوحدها.</p>}
      {state === 'denied' && <p className="small muted">الإشعارات مقفولة للتطبيق ده من إعدادات الموبايل. افتحها من هناك لو عايزها.</p>}
      {state === 'default' && (
        <>
          <p className="small muted">هيوصلك إشعار لما يفضل قدّامك اتنين، ولما دورك يجي.</p>
          <Button variant="primary" icon="bell" loading={busy} onClick={enable}>فعّل الإشعارات</Button>
        </>
      )}
      {error && <Notice tone="danger" icon="alert">{error}</Notice>}
    </Mirror>
  );
}
