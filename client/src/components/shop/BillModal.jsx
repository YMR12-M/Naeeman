/**
 * ═══════════════════════════════════════════════════════════════
 *  الفاتورة: السطور، والدفع، والمرتجع، والطباعة
 *
 *  بتتفتح من الكاشير (فاتورة موجودة) أو من الطابور (`ticketId`: فاتورة
 *  الدور بتتفتح بدري لو الزبون اشترى منتج وهو مستني).
 *
 *  الدفع: طريقة واحدة بالمبلغ كله افتراضيًا، و«اقسم» بيزوّد سطر بالفاضل.
 *  الكاش فيه «اتدفع كام» والباقي بيتحسب قدّامك. السيرفر بيعيد الحساب كله
 *  ويرفض أي فرق، والطلب بمفتاح منع تكرار.
 * ═══════════════════════════════════════════════════════════════
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { Icon } from '../../lib/icons.jsx';
import { formatDateTime, formatMoney } from '../../lib/format.js';
import {
  METHOD_ICONS, cashierDiscountLimit, paymentState, rewardPreview, splitLine, tenderSuggestions,
} from '../../lib/cashier.js';
import { printHtml, receiptHtml } from '../../lib/receipt.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  Button, Checkbox, Field, Input, Loading, Modal, MoneyInput, Notice, Select, Switch, useConfirm,
} from '../ui/index.js';
import { LeatherButton, TicketNumber } from '../brand/index.jsx';
import { LoyaltyNote, StampRow } from './CardBits.jsx';

const STATUS = { open: 'مستنية الدفع', paid: 'اتدفعت', void: 'ملغية' };

export async function printReceipt(billId, options) {
  const data = await api.get(`/bills/${billId}/receipt`);
  await printHtml(receiptHtml(data, options), { width: data.width });
}

/* ── إضافة سطر: منتج بالاسم أو بالباركود، أو خدمة ── */
function AddLine({ bill, onAdded }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get('/products') });
  const services = useQuery({ queryKey: ['services'], queryFn: () => api.get('/services') });

  const matches = useMemo(() => {
    const q = text.trim();
    if (!q) return [];
    return (products.data ?? []).filter((product) => product.active && (product.name.includes(q) || product.barcode === q)).slice(0, 6);
  }, [text, products.data]);

  async function add(body) {
    setBusy(true);
    try {
      onAdded(await api.post(`/bills/${bill.id}/items`, body));
      setText('');
      input.current?.focus();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  /** الماسح بيكتب الأرقام وبعدها Enter */
  async function onKeyDown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const q = text.trim();
    if (!q) return;
    if (matches.length === 1) { add({ product_id: matches[0].id }); return; }
    if (/^\d{4,}$/.test(q)) {
      try {
        const product = await api.get('/products/lookup', { barcode: q });
        add({ product_id: product.id });
      } catch (error) {
        toast.error(error.message);
      }
    }
  }

  return (
    <div className="stack sm add-line">
      <div className="product-search">
        <Icon name="search" size={18} />
        <input
          ref={input}
          className="input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="منتج بالاسم أو امسح الباركود"
          aria-label="زوّد منتج"
          disabled={busy}
        />
      </div>
      {matches.length > 0 && (
        <ul className="product-matches">
          {matches.map((product) => (
            <li key={product.id}>
              <button type="button" onClick={() => add({ product_id: product.id })} disabled={busy}>
                <span className="grow">{product.name}</span>
                {product.track_stock && <span className={`small ${product.stock_qty <= 0 ? 'danger-text' : 'muted'}`}>فاضل <span className="num">{product.stock_qty}</span></span>}
                <span className="num bold">{formatMoney(product.price)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(services.data ?? []).length > 0 && (
        <div className="chips" role="group" aria-label="زوّد خدمة">
          {(services.data ?? []).filter((service) => service.active).map((service) => (
            <button key={service.id} type="button" className="chip" disabled={busy} onClick={() => add({ service_id: service.id })}>
              <Icon name="plus" size={14} />{service.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── الدفع ── */
function Checkout({ bill, settings, methods, onPaid }) {
  const { can } = useAuth();
  const toast = useToast();
  const [discountOn, setDiscountOn] = useState(false);
  const [discount, setDiscount] = useState(null);
  const [reason, setReason] = useState('');
  const [redeem, setRedeem] = useState(false);
  const [tip, setTip] = useState(null);
  const [lines, setLines] = useState([]);
  const [error, setError] = useState(null);
  const [paying, setPaying] = useState(false);
  const touched = useRef(false);

  const active = methods.filter((method) => method.active);
  const cash = active.find((method) => method.kind === 'cash') ?? active[0];
  const subtotal = bill.items.reduce((sum, item) => sum + item.line_total, 0);
  const discountValue = discountOn ? discount ?? 0 : 0;
  const reward = redeem ? rewardPreview(settings, bill.items, subtotal - discountValue) : 0;
  const total = Math.max(0, subtotal - discountValue - reward);
  const state = paymentState({ total, tip: tip ?? 0, lines });
  const limit = cashierDiscountLimit(subtotal, settings.max_cashier_discount_pct);
  const overLimit = discountValue > limit && !can('billing.discount');

  // سطر واحد بالمبلغ كله لحد ما الكاشير يقسم بإيده
  useEffect(() => {
    if (!cash) return;
    if (!touched.current || lines.length <= 1) {
      setLines([{ method: (lines[0]?.method ?? cash.code), kind: (lines[0]?.kind ?? cash.kind), amount: state.due, tendered: lines[0]?.tendered ?? null, reference: lines[0]?.reference ?? '' }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- بنحدّث المبلغ لما المطلوب يتغيّر بس
  }, [state.due, cash?.code]);

  const update = (index, patch) => {
    touched.current = true;
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  async function pay() {
    setError(null);
    if (discountValue > 0 && reason.trim().length < 2) { setError('اكتب سبب الخصم'); return; }
    setPaying(true);
    try {
      const result = await api.act(`/bills/${bill.id}/checkout`, {
        discount: discountValue || undefined,
        discount_reason: discountValue ? reason.trim() : undefined,
        redeem_reward: redeem || undefined,
        tip: tip || undefined,
        payments: state.due === 0 ? [] : lines.map((line) => ({
          method: line.method,
          amount: Number(line.amount) || 0,
          tendered: line.kind === 'cash' && line.tendered ? line.tendered : undefined,
          reference: line.reference?.trim() || undefined,
        })),
      });
      toast.success(result.change ? `اتدفعت — الباقي ${formatMoney(result.change).replace(/[⁧⁩]/g, '')}` : 'اتدفعت');
      onPaid(result);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPaying(false);
    }
  }

  if (!cash) return <Notice tone="danger" icon="alert">مفيش طرق دفع شغّالة — شغّل واحدة من الإعدادات.</Notice>;

  return (
    <div className="stack checkout">
      {bill.card?.loyalty?.eligible && settings.loyalty_enabled && (
        <div className="reward-toggle">
          <Switch checked={redeem} onChange={setRedeem} label={<span className="bold">اصرف المكافأة: {bill.card.loyalty.reward}</span>} />
          {redeem && reward === 0 && <span className="small danger-text">المكافأة مش على أي سطر في الفاتورة دي</span>}
        </div>
      )}

      <div className="row wrap">
        <Checkbox label="خصم" checked={discountOn} onChange={(event) => setDiscountOn(event.target.checked)} />
        {discountOn && (
          <>
            <div style={{ width: 150 }}><MoneyInput currency="ج" value={discount} onChange={setDiscount} aria-label="مبلغ الخصم" /></div>
            <Input className="grow" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="السبب (زبون قديم، تعويض…)" aria-label="سبب الخصم" />
          </>
        )}
      </div>
      {overLimit && <Notice tone="warn" icon="alert">أقصى خصم للاستقبال {settings.max_cashier_discount_pct}% ({formatMoney(limit)}) — كلّم المدير.</Notice>}

      <div className="row">
        <span className="muted" style={{ minWidth: 70 }}>بقشيش</span>
        <div style={{ width: 150 }}><MoneyInput currency="ج" value={tip} onChange={setTip} aria-label="بقشيش" /></div>
        {bill.barber && <span className="small muted nowrap">لـ أ. {bill.barber.name}</span>}
      </div>

      <div className="bill-total">
        <span>المطلوب</span>
        <TicketNumber value={formatMoney(state.due).replace(/[⁧⁩]/g, '')} size="2.2rem" />
      </div>

      {state.due > 0 && (
        <div className="stack sm">
          {lines.map((line, index) => {
            const method = active.find((item) => item.code === line.method);
            return (
              <div key={index} className="pay-line">
                <Select
                  value={line.method}
                  aria-label="طريقة الدفع"
                  onChange={(event) => {
                    const next = active.find((item) => item.code === event.target.value);
                    update(index, { method: next.code, kind: next.kind, tendered: null });
                  }}
                >
                  {active.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
                </Select>
                <div className="pay-amount"><MoneyInput currency="ج" value={line.amount} onChange={(value) => update(index, { amount: value ?? 0 })} aria-label="المبلغ" /></div>
                {method?.kind === 'cash' ? (
                  <div className="pay-tender">
                    <MoneyInput currency="ج" value={line.tendered} onChange={(value) => update(index, { tendered: value })} placeholder="اتدفع كام؟" aria-label="الزبون ادّى كام" />
                    <div className="chips tight">
                      {tenderSuggestions(Number(line.amount)).map((value) => (
                        <button key={value} type="button" className="chip" onClick={() => update(index, { tendered: value })}>
                          <span className="num">{value / 100}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <Input value={line.reference} onChange={(event) => update(index, { reference: event.target.value })} placeholder="رقم العملية (اختياري)" aria-label="رقم العملية" />
                )}
                {lines.length > 1 && (
                  <Button size="sm" variant="ghost" icon="trash" aria-label="شيل السطر" onClick={() => { touched.current = true; setLines((current) => current.filter((_, i) => i !== index)); }} />
                )}
              </div>
            );
          })}
          <div className="row between wrap">
            <Button size="sm" variant="ghost" icon="plus" disabled={lines.length >= 5}
              onClick={() => { touched.current = true; setLines((current) => splitLine(current, state.due, active.find((item) => item.code !== current[0]?.method) ?? cash)); }}>
              اقسم على طريقة تانية
            </Button>
            <span className="small">
              {state.remaining > 0 && <>فاضل <span className="num bold">{formatMoney(state.remaining)}</span></>}
              {state.remaining < 0 && <span className="danger-text">زيادة <span className="num bold">{formatMoney(-state.remaining)}</span></span>}
              {state.change > 0 && state.remaining === 0 && <>الباقي للزبون <span className="num bold">{formatMoney(state.change)}</span></>}
            </span>
          </div>
        </div>
      )}

      {error && <Notice tone="danger" icon="alert">{error}</Notice>}
      <LeatherButton block size="lg" loading={paying} disabled={!state.valid || overLimit || (redeem && reward === 0)} onClick={pay}>
        ادفع {formatMoney(state.due)}
      </LeatherButton>
    </div>
  );
}

/* ── المرتجع ── */
function RefundModal({ bill, methods, onClose, onDone }) {
  const toast = useToast();
  const refundable = bill.paid - bill.refunded;
  const [amount, setAmount] = useState(refundable);
  const [method, setMethod] = useState(methods.find((item) => item.kind === 'cash')?.code ?? methods[0]?.code);
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState({});
  const [busy, setBusy] = useState(false);
  const products = bill.items.filter((item) => item.kind === 'product');

  async function submit() {
    setBusy(true);
    try {
      const lines = Object.entries(restock).filter(([, qty]) => qty > 0).map(([id, qty]) => ({ item_id: Number(id), qty }));
      onDone(await api.act(`/bills/${bill.id}/refund`, { amount, method, reason: reason.trim(), restock: lines.length ? lines : undefined }));
      toast.success('المرتجع اتسجّل');
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`مرتجع من فاتورة ${bill.number}`} size="narrow"
      footer={<><Button onClick={onClose}>رجوع</Button><Button variant="danger" loading={busy} disabled={!amount || amount > refundable || reason.trim().length < 2} onClick={submit}>سجّل المرتجع</Button></>}>
      <div className="stack">
        <Field label="المبلغ" hint={`أقصى حاجة ${formatMoney(refundable)}`.replace(/[⁧⁩]/g, '')}>
          {(props) => <MoneyInput {...props} currency="ج" value={amount} onChange={setAmount} />}
        </Field>
        <Field label="رجّع بـ">
          {(props) => <Select {...props} value={method} onChange={(event) => setMethod(event.target.value)}>{methods.filter((item) => item.active).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</Select>}
        </Field>
        <Field label="السبب" required>
          {(props) => <Input {...props} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="المنتج مكسور، الزبون مش راضي…" />}
        </Field>
        {products.length > 0 && (
          <div className="stack sm">
            <span className="small muted">منتجات ترجع المخزن</span>
            {products.map((item) => (
              <label key={item.id} className="row">
                <span className="grow">{item.name}</span>
                <Input type="number" min={0} max={item.qty} style={{ width: 80 }} value={restock[item.id] ?? 0}
                  onChange={(event) => setRestock((current) => ({ ...current, [item.id]: Math.max(0, Math.min(item.qty, Number(event.target.value) || 0)) }))} />
                <span className="small muted">من <span className="num">{item.qty}</span></span>
              </label>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ═══════════════════ النافذة ═══════════════════ */

export default function BillModal({ billId = null, ticketId = null, onClose, onChanged }) {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [id, setId] = useState(billId);
  const [refunding, setRefunding] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (id || !ticketId) return;
    api.post(`/bills/for-ticket/${ticketId}`)
      .then((bill) => { queryClient.setQueryData(['bill', bill.id], bill); setId(bill.id); })
      .catch((error) => { toast.error(error.message); onClose(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- مرّة واحدة لما النافذة تتفتح
  }, []);

  const bill = useQuery({ queryKey: ['bill', id], queryFn: () => api.get(`/bills/${id}`), enabled: Boolean(id) });
  const shop = useQuery({ queryKey: ['shop'], queryFn: () => api.get('/shop') });
  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: () => api.get('/payment-methods') });

  const changed = (next) => {
    queryClient.setQueryData(['bill', next.id], next);
    queryClient.invalidateQueries({ queryKey: ['bills'] });
    queryClient.invalidateQueries({ queryKey: ['drawer'] });
    onChanged?.(next);
  };

  async function print() {
    setPrinting(true);
    try { await printReceipt(id); } catch (error) { toast.error(error.message); } finally { setPrinting(false); }
  }

  async function removeLine(item) {
    try { changed(await api.del(`/bills/${id}/items/${item.id}`)); } catch (error) { toast.error(error.message); }
  }

  async function voidBill() {
    const answer = await confirm({
      title: `إلغاء فاتورة ${bill.data.number}`, message: 'الفاتورة هتتقفل من غير دفع، وده بيتسجّل في السجل.',
      confirmLabel: 'ألغِ الفاتورة', danger: true, reason: { label: 'السبب', required: true },
    });
    if (!answer) return;
    try { changed(await api.post(`/bills/${id}/void`, { reason: answer.reason })); toast.success('الفاتورة اتلغت'); } catch (error) { toast.error(error.message); }
  }

  const data = bill.data;
  const settings = shop.data?.settings;
  const title = data ? `فاتورة ${data.number}${data.customer_name ? ` — ${data.customer_name}` : ''}` : 'الفاتورة';

  return (
    <Modal open onClose={onClose} title={title} size="wide"
      footer={data && (
        <>
          {data.status === 'open' && <Button variant="ghost" icon="ban" onClick={voidBill}>ألغِ الفاتورة</Button>}
          {data.status === 'paid' && can('billing.refund') && data.paid > data.refunded && <Button variant="ghost" icon="refresh" onClick={() => setRefunding(true)}>مرتجع</Button>}
          <Button icon="print" loading={printing} onClick={print}>{data.status === 'paid' ? 'اطبع الإيصال' : 'اطبع'}</Button>
          <Button onClick={onClose}>خلاص</Button>
        </>
      )}>
      {!data || !settings || !methods.data ? <Loading /> : (
        <div className="bill">
          <div className="bill-main stack">
            <div className="row wrap small">
              <span className={`badge ${data.status === 'paid' ? 'ok' : data.status === 'void' ? 'warn' : 'marker'}`}>{STATUS[data.status]}</span>
              {data.ticket && <span className="muted">دور رقم <span className="num">{data.ticket.number}</span></span>}
              {data.barber && <span className="muted">أ. {data.barber.name}</span>}
              {data.customer_phone && <span className="muted num">{data.customer_phone}</span>}
              {data.paid_at && <span className="muted">{formatDateTime(data.paid_at)}</span>}
            </div>

            {data.card && (
              <div className="bill-card">
                <div className="grow stack xs">
                  <StampRow loyalty={data.card.loyalty} size="sm" />
                  <LoyaltyNote loyalty={data.card.loyalty} />
                </div>
                {data.card.notes && <p className="small bill-note"><Icon name="edit" size={14} /> {data.card.notes}</p>}
              </div>
            )}

            <ul className="bill-lines">
              {data.items.length === 0 && <li className="muted small">الفاتورة فاضية — زوّد منتج أو خدمة.</li>}
              {data.items.map((item) => (
                <li key={item.id}>
                  <Icon name={item.kind === 'service' ? 'scissors' : 'tag'} size={16} />
                  <span className="grow">
                    {item.name}
                    {item.qty > 1 && <span className="small muted"> × <span className="num">{item.qty}</span></span>}
                    {item.barber_name && <span className="small muted"> · أ. {item.barber_name}</span>}
                  </span>
                  {(item.discount_share > 0 || item.reward_share > 0) && (
                    <span className="small muted strike num">{formatMoney(item.line_total)}</span>
                  )}
                  <span className="num bold">{formatMoney(item.line_total - item.discount_share - item.reward_share)}</span>
                  {data.status === 'open' && (item.kind === 'product' || can('billing.discount')) && (
                    <Button size="sm" variant="ghost" icon="trash" aria-label={`شيل ${item.name}`} onClick={() => removeLine(item)} />
                  )}
                </li>
              ))}
            </ul>

            {data.status === 'open' && <AddLine bill={data} onAdded={changed} />}

            {data.status !== 'open' && (
              <div className="stack sm bill-summary">
                <div className="row between"><span>المجموع</span><span className="num">{formatMoney(data.subtotal)}</span></div>
                {data.discount > 0 && <div className="row between"><span>خصم {data.discount_reason && <span className="small muted">({data.discount_reason})</span>}</span><span className="num">{formatMoney(data.discount, { sign: '−' })}</span></div>}
                {data.reward_discount > 0 && <div className="row between"><span>مكافأة الأختام</span><span className="num">{formatMoney(data.reward_discount, { sign: '−' })}</span></div>}
                <div className="row between bold"><span>الإجمالي</span><span className="num">{formatMoney(data.total)}</span></div>
                {data.tip > 0 && <div className="row between"><span>بقشيش</span><span className="num">{formatMoney(data.tip)}</span></div>}
                {data.payments.map((payment) => (
                  <div key={payment.id} className="row between small">
                    <span>{payment.kind === 'refund' ? `مرتجع (${payment.reason})` : payment.method_label}{payment.reference && <span className="muted"> · {payment.reference}</span>}</span>
                    <span className={`num ${payment.amount < 0 ? 'danger-text' : ''}`}>{formatMoney(payment.amount)}</span>
                  </div>
                ))}
                {data.change_given > 0 && <div className="row between small"><span>الباقي اللي اترجع</span><span className="num">{formatMoney(data.change_given)}</span></div>}
                {data.void_reason && <Notice icon="ban">اتلغت: {data.void_reason}</Notice>}
              </div>
            )}
          </div>

          {data.status === 'open' && (
            <aside className="bill-side">
              <Checkout bill={data} settings={settings} methods={methods.data} onPaid={(paid) => {
                changed(paid);
                if (settings.receipt_auto_print) printReceipt(paid.id).catch((error) => toast.error(error.message));
              }} />
            </aside>
          )}
        </div>
      )}
      {refunding && data && <RefundModal bill={data} methods={methods.data} onClose={() => setRefunding(false)} onDone={changed} />}
    </Modal>
  );
}
