/**
 * زبون نسي كلمة سر التطبيق ومالوش بريد: الاستقبال بيطلّع له كود من 6 أرقام
 * وهو واقف قدّامه. الكود بيظهر هنا مرّة واحدة، وصالح ربع ساعة، والزبون
 * بيكتبه في التطبيق («نسيت كلمة السر» ← «معايا كود من المحل»).
 */
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { formatPhone } from '../../lib/format.js';
import { Button, Field, Input, Modal, Notice } from '../ui/index.js';
import { LeatherButton, Mirror } from '../brand/index.jsx';

export default function RecoveryCodeModal({ open, onClose }) {
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const close = () => { setPhone(''); setResult(null); setError(null); onClose(); };

  async function submit(event) {
    event.preventDefault();
    if (!phone.trim()) { setError('اكتب رقم موبايل الزبون'); return; }
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post('/customers/recovery-code', { phone: phone.trim() }));
    } catch (failure) {
      setError(failure.errors?.phone ?? failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="زبون نسي كلمة السر"
      size="narrow"
      footer={result
        ? <LeatherButton onClick={close}>تمام</LeatherButton>
        : (
          <>
            <Button onClick={close}>رجوع</Button>
            <LeatherButton type="submit" form="recovery-code" loading={busy}>طلّع الكود</LeatherButton>
          </>
        )}
    >
      {result ? (
        <div className="stack center">
          <p>
            الكود لـ <span className="bold">{result.customer.name}</span>
            {' '}(<span className="num">{formatPhone(result.customer.phone)}</span>)
          </p>
          <Mirror arch className="pair-code">
            <span className="ticket-number" dir="ltr" style={{ fontSize: 'clamp(2.4rem, 9vw, 3.4rem)', letterSpacing: '0.12em' }}>{result.code}</span>
          </Mirror>
          <p className="small muted">
            الزبون يفتح التطبيق ← «نسيت كلمة السر» ← «معايا كود من المحل»، ويكتب رقمه والكود وكلمة سر جديدة.
            الكود صالح <span className="num">{result.expires_in_minutes}</span> دقيقة ومرّة واحدة.
          </p>
        </div>
      ) : (
        <form id="recovery-code" className="stack" onSubmit={submit} noValidate>
          <Notice icon="alert">اتأكد إن صاحب الرقم هو اللي واقف قدّامك قبل ما تديله الكود.</Notice>
          {error && <Notice tone="danger" icon="alert">{error}</Notice>}
          <Field label="موبايل الزبون">
            {(props) => <Input {...props} type="tel" dir="ltr" className="ltr-input" value={phone} onChange={(event) => setPhone(event.target.value)} data-autofocus />}
          </Field>
        </form>
      )}
    </Modal>
  );
}
