/**
 * المنتجات والمخزن: جِل، وشمع، وكريمات… بالسعر والتكلفة والكمية.
 * الكمية بتتغيّر بحركة بس (شراء، جرد، استهلاك، وبيع من الفاتورة)، وكل
 * حركة ليها سطر في «الحركات».
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { formatDateTime, formatMoney } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  Button, Empty, Field, Input, Loading, Modal, MoneyInput, Notice, SearchInput, Segmented, Switch, useConfirm,
} from '../components/ui/index.js';
import { LeatherButton, Mirror } from '../components/brand/index.jsx';
import PageHead from '../components/layout/PageHead.jsx';

const MOVE_LABELS = { purchase: 'شراء', sale: 'بيع', refund: 'مرتجع', adjust: 'جرد', use: 'استهلاك' };

function ProductModal({ product, onClose }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const form = useForm({
    name: product?.name ?? '', barcode: product?.barcode ?? '', price: product?.price ?? null, cost: product?.cost ?? null,
    track_stock: product?.track_stock ?? true, low_stock_at: product?.low_stock_at ?? '', initial_qty: '',
  });
  const [message, setMessage] = useState(null);
  const save = useMutation({
    mutationFn: (body) => (product ? api.patch(`/products/${product.id}`, body) : api.post('/products', body)),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); toast.success(product ? 'اتعدّل' : 'اتضاف'); onClose(); },
    onError: (error) => setMessage(form.fail(error)),
  });

  function submit(event) {
    event.preventDefault();
    const v = form.values;
    if (v.price === null) { form.setErrors({ price: 'اكتب سعر البيع' }); return; }
    const body = {
      name: v.name.trim(), barcode: v.barcode.trim() || null, price: v.price, cost: v.cost ?? 0, track_stock: v.track_stock,
      low_stock_at: v.low_stock_at === '' ? null : Number(v.low_stock_at),
    };
    if (!product && v.track_stock && v.initial_qty !== '') body.initial_qty = Number(v.initial_qty);
    save.mutate(body);
  }

  return (
    <Modal open onClose={onClose} title={product ? `تعديل «${product.name}»` : 'منتج جديد'}
      footer={<><Button onClick={onClose}>رجوع</Button><LeatherButton type="submit" form="product-form" loading={save.isPending}>حفظ</LeatherButton></>}>
      <form id="product-form" className="stack" onSubmit={submit} noValidate>
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}
        <div className="grid cols-2">
          <Field label="المنتج" error={form.errors.name} required>
            {(props) => <Input {...props} value={form.values.name} onChange={form.on('name')} maxLength={80} autoFocus placeholder="جِل شعر 250 مل" />}
          </Field>
          <Field label="الباركود" hint="امسحه بالماسح هنا" error={form.errors.barcode}>
            {(props) => <Input {...props} dir="ltr" className="ltr-input" value={form.values.barcode} onChange={form.on('barcode')} maxLength={40} />}
          </Field>
          <Field label="سعر البيع" error={form.errors.price} required>
            {(props) => <MoneyInput {...props} currency="ج" value={form.values.price} onChange={(value) => form.set('price', value)} />}
          </Field>
          <Field label="التكلفة" hint="بتتحدّث لوحدها مع كل شراء" error={form.errors.cost}>
            {(props) => <MoneyInput {...props} currency="ج" value={form.values.cost} onChange={(value) => form.set('cost', value)} />}
          </Field>
        </div>
        <Switch checked={form.values.track_stock} onChange={(value) => form.set('track_stock', value)} label="تابع الكمية في المخزن" />
        {form.values.track_stock && (
          <div className="grid cols-2">
            {!product && (
              <Field label="الكمية دلوقتي" error={form.errors.initial_qty}>
                {(props) => <Input {...props} type="number" min={0} value={form.values.initial_qty} onChange={form.on('initial_qty')} />}
              </Field>
            )}
            <Field label="نبّهني لما يفضل" hint="فاضي = من غير تنبيه" error={form.errors.low_stock_at}>
              {(props) => <Input {...props} type="number" min={0} value={form.values.low_stock_at} onChange={form.on('low_stock_at')} />}
            </Field>
          </div>
        )}
      </form>
    </Modal>
  );
}

function StockModal({ product, onClose }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState('purchase');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState(product.cost || null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const moves = useQuery({ queryKey: ['products', product.id, 'moves'], queryFn: () => api.get(`/products/${product.id}/movements`) });

  async function save() {
    setBusy(true);
    try {
      const body = type === 'adjust'
        ? { type, counted_qty: Number(qty), note: note.trim() }
        : { type, qty: Number(qty), ...(type === 'purchase' ? { unit_cost: cost ?? undefined } : {}), note: note.trim() || undefined };
      await api.post(`/products/${product.id}/stock`, body);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('اتسجّلت');
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  const invalid = qty === '' || (type !== 'adjust' && Number(qty) < 1) || (type === 'adjust' && note.trim().length < 2);
  return (
    <Modal open onClose={onClose} title={`مخزن «${product.name}»`}
      footer={<><Button onClick={onClose}>رجوع</Button><Button variant="primary" loading={busy} disabled={invalid} onClick={save}>سجّل</Button></>}>
      <div className="stack">
        <p className="soft">في المخزن دلوقتي <span className="num bold">{product.stock_qty}</span></p>
        <Segmented label="نوع الحركة" value={type} onChange={(value) => { setType(value); setQty(''); }} options={[
          { value: 'purchase', label: 'اشتريت' }, { value: 'adjust', label: 'جرد' }, { value: 'use', label: 'استهلاك للمحل' },
        ]} />
        <div className="grid cols-2">
          <Field label={type === 'adjust' ? 'العدد اللي اتعدّ' : 'الكمية'} required>
            {(props) => <Input {...props} type="number" min={type === 'adjust' ? -100000 : 1} value={qty} onChange={(event) => setQty(event.target.value)} />}
          </Field>
          {type === 'purchase' && (
            <Field label="تكلفة الحتّة">
              {(props) => <MoneyInput {...props} currency="ج" value={cost} onChange={setCost} />}
            </Field>
          )}
        </div>
        <Field label={type === 'adjust' ? 'سبب الفرق' : 'ملاحظة'} required={type === 'adjust'}>
          {(props) => <Input {...props} value={note} onChange={(event) => setNote(event.target.value)} maxLength={190} placeholder={type === 'adjust' ? 'جرد آخر الشهر' : ''} />}
        </Field>
        <details className="small">
          <summary className="muted">آخر الحركات</summary>
          {!moves.data ? <Loading /> : (
            <ul className="visit-list">
              {moves.data.map((move) => (
                <li key={move.id}>
                  <span className="muted">{formatDateTime(move.created_at)}</span>
                  <span className="grow truncate">{MOVE_LABELS[move.type]}{move.note && <span className="muted"> · {move.note}</span>}{move.created_by_name && <span className="muted"> · {move.created_by_name}</span>}</span>
                  <span className="num">{move.qty > 0 ? `+${move.qty}` : move.qty}</span>
                  <span className="num muted">= {move.stock_after}</span>
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>
    </Modal>
  );
}

export default function Products() {
  useDocumentTitle('المنتجات');
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [stock, setStock] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const list = useQuery({ queryKey: ['products', 'all'], queryFn: () => api.get('/products', { include_archived: true }) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['products'] });

  if (!list.data) return <Loading />;
  const query = q.trim();
  const current = list.data.filter((product) => !product.archived_at && (!query || product.name.includes(query) || product.barcode === query));
  const archived = list.data.filter((product) => product.archived_at);
  const low = current.filter((product) => product.low_stock || (product.track_stock && product.stock_qty <= 0));

  async function archive(product) {
    const answer = await confirm({ title: `أرشفة «${product.name}»؟`, message: 'هيختفي من الكاشير، والفواتير القديمة فاضلة زي ما هي.', confirmLabel: 'أرشف', danger: true });
    if (!answer) return;
    try { await api.del(`/products/${product.id}`); refresh(); } catch (error) { toast.error(error.message); }
  }

  return (
    <div className="stack lg">
      <PageHead title="المنتجات">
        <SearchInput value={q} onChange={setQ} placeholder="اسم أو باركود" aria-label="دوّر على منتج" />
        {can('products.write') && <LeatherButton onClick={() => setEditing('new')}>منتج جديد</LeatherButton>}
      </PageHead>

      {low.length > 0 && (
        <Notice tone="warn" icon="alert">
          قرّب يخلص: {low.map((product) => `${product.name} (${product.stock_qty})`).join('، ')}
        </Notice>
      )}

      <Mirror className="price-board">
        {current.length === 0 ? (
          <Empty icon="tag" title={query ? 'مفيش حاجة بالاسم ده' : 'مفيش منتجات'}>المنتجات اللي المحل بيبيعها (جِل، شمع، كريمات) بتتباع من الكاشير.</Empty>
        ) : (
          <ol className="price-list">
            {current.map((product) => (
              <li key={product.id} className={product.active ? '' : 'is-off'}>
                <div className="grow">
                  <div className="bold">{product.name}</div>
                  <div className="small muted">
                    {product.barcode && <><span className="num">{product.barcode}</span> · </>}
                    التكلفة {formatMoney(product.cost)}
                  </div>
                </div>
                {product.track_stock ? (
                  <span className={`badge ${product.stock_qty <= 0 ? 'warn' : product.low_stock ? 'marker' : ''}`}>
                    <span className="num">{product.stock_qty}</span> في المخزن
                  </span>
                ) : <span className="badge">من غير مخزن</span>}
                <span className="num bold">{formatMoney(product.price)}</span>
                <div className="row tight price-tools">
                  {can('stock.write') && product.track_stock && <Button size="sm" variant="ghost" icon="list" aria-label={`مخزن ${product.name}`} onClick={() => setStock(product)} />}
                  {can('products.write') && <Button size="sm" variant="ghost" icon="edit" aria-label={`تعديل ${product.name}`} onClick={() => setEditing(product)} />}
                  {can('products.write') && <Button size="sm" variant="ghost" icon="trash" aria-label={`أرشفة ${product.name}`} onClick={() => archive(product)} />}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Mirror>

      {archived.length > 0 && can('products.write') && (
        <div className="stack sm">
          <Button variant="ghost" size="sm" onClick={() => setShowArchived((value) => !value)}>
            {showArchived ? 'اخفي المؤرشف' : `المؤرشف (${archived.length})`}
          </Button>
          {showArchived && (
            <ul className="archived-list">
              {archived.map((product) => (
                <li key={product.id} className="row between">
                  <span>{product.name}</span>
                  <Button size="sm" onClick={() => api.post(`/products/${product.id}/restore`).then(refresh)}>رجّعه</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && <ProductModal product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {stock && <StockModal product={stock} onClose={() => setStock(null)} />}
    </div>
  );
}
