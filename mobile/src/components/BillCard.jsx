/**
 * فاتورة الدور زي ما الزبون يشوفها: السطور والخصم والإجمالي والدفع، وهل
 * اتحط ختم أو اتصرفت مكافأة. من غير أي حاجة داخلية (عمولة أو تكلفة).
 */
import { formatMoney } from '../lib/format.js';
import { Icon } from '../lib/icons.jsx';
import { Mirror } from './brand/index.jsx';

const Row = ({ label, value, strong = false, muted = false }) => (
  <div className={`bill-row ${strong ? 'strong' : ''} ${muted ? 'muted' : ''}`.trim()}>
    <span>{label}</span>
    <span className="leader" aria-hidden="true" />
    <span className="num">{value}</span>
  </div>
);

export default function BillCard({ bill }) {
  if (!bill) return null;
  const paid = bill.status === 'paid';
  const payments = bill.payments.filter((payment) => payment.kind === 'payment');
  const refunds = bill.payments.filter((payment) => payment.kind === 'refund');

  return (
    <Mirror thin className="stack sm page-card bill-card">
      <div className="row between">
        <h2>الفاتورة <span className="num small muted">#{bill.number}</span></h2>
        <span className={`badge ${paid ? 'ok' : 'info'}`}>{paid ? 'اتدفعت' : 'لسه ما اتدفعتش'}</span>
      </div>

      <div className="stack sm">
        {bill.items.map((item, index) => (
          <Row
            key={index}
            label={<>{item.name}{item.qty > 1 && <span className="num small muted"> × {item.qty}</span>}</>}
            value={formatMoney(item.line_total)}
          />
        ))}
      </div>

      <div className="stack sm bill-sum">
        {(bill.discount > 0 || bill.reward_discount > 0) && <Row label="المجموع" value={formatMoney(bill.subtotal)} muted />}
        {bill.discount > 0 && <Row label="خصم" value={formatMoney(bill.discount, { sign: '−' })} muted />}
        {bill.reward_discount > 0 && <Row label="مكافأة الأختام" value={formatMoney(bill.reward_discount, { sign: '−' })} muted />}
        <Row label="الإجمالي" value={formatMoney(bill.total)} strong />
        {bill.tip > 0 && <Row label="بقشيش" value={formatMoney(bill.tip)} muted />}
        {payments.map((payment, index) => <Row key={`p${index}`} label={payment.label} value={formatMoney(payment.amount)} muted />)}
        {refunds.map((payment, index) => <Row key={`r${index}`} label={`مرتجع (${payment.label})`} value={formatMoney(-payment.amount, { sign: '−' })} muted />)}
      </div>

      {bill.reward_redeemed && <p className="small row"><Icon name="star" size={15} /><span>استلمت مكافأة الأختام</span></p>}
      {!bill.reward_redeemed && bill.stamp_awarded && <p className="small row"><Icon name="scissors" size={15} /><span>اتضاف ختم على كارتك</span></p>}
    </Mirror>
  );
}
