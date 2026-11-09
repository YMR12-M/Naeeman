import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import BillCard from './BillCard.jsx';
import { StampRow, LoyaltyNote } from './CardBits.jsx';

const bill = (patch = {}) => ({
  number: 41,
  status: 'paid',
  subtotal: 14000,
  discount: 0,
  reward_discount: 0,
  total: 14000,
  tip: 0,
  paid: 14000,
  refunded: 0,
  stamp_awarded: true,
  reward_redeemed: false,
  items: [
    { kind: 'service', name: 'قص', qty: 1, unit_price: 8000, line_total: 8000 },
    { kind: 'product', name: 'جِل', qty: 2, unit_price: 3000, line_total: 6000 },
  ],
  payments: [{ label: 'كاش', amount: 14000, kind: 'payment' }],
  ...patch,
});

describe('فاتورة الزبون', () => {
  test('السطور والإجمالي وطريقة الدفع والختم', () => {
    render(<BillCard bill={bill()} />);
    expect(screen.getByText('اتدفعت')).toBeInTheDocument();
    expect(screen.getByText('قص')).toBeInTheDocument();
    expect(screen.getByText('جِل')).toBeInTheDocument();
    expect(screen.getByText(/× 2/)).toBeInTheDocument();
    expect(screen.getByText('الإجمالي')).toBeInTheDocument();
    expect(screen.getByText('كاش')).toBeInTheDocument();
    expect(screen.getByText(/اتضاف ختم على كارتك/)).toBeInTheDocument();
  });

  test('الخصم والمكافأة بيظهروا مع المجموع، ولو المكافأة اتصرفت مفيش «اتضاف ختم»', () => {
    render(<BillCard bill={bill({ discount: 1000, reward_discount: 8000, total: 5000, reward_redeemed: true, stamp_awarded: false })} />);
    expect(screen.getByText('المجموع')).toBeInTheDocument();
    expect(screen.getByText('خصم')).toBeInTheDocument();
    expect(screen.getByText('مكافأة الأختام')).toBeInTheDocument();
    expect(screen.getByText(/استلمت مكافأة الأختام/)).toBeInTheDocument();
    expect(screen.queryByText(/اتضاف ختم على كارتك/)).toBeNull();
  });

  test('فاتورة لسه مفتوحة', () => {
    render(<BillCard bill={bill({ status: 'open', payments: [] })} />);
    expect(screen.getByText('لسه ما اتدفعتش')).toBeInTheDocument();
  });

  test('من غير فاتورة ما بيترسمش حاجة', () => {
    const { container } = render(<BillCard bill={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('كارت الأختام', () => {
  const loyalty = { enabled: true, stamps: 6, required: 9, left: 3, eligible: false, reward: 'قص ببلاش' };

  test('الأختام المليانة والمكافأة', () => {
    render(<StampRow loyalty={loyalty} />);
    const row = screen.getByRole('img', { name: '6 ختم من 9' });
    expect(row.querySelectorAll('.stamp.on')).toHaveLength(6);
    expect(row.querySelectorAll('.stamp')).toHaveLength(10);
  });

  test('الجملة: فاضلّك كام، ثم «المكافأة جاهزة»', () => {
    const { rerender } = render(<LoyaltyNote loyalty={loyalty} />);
    expect(screen.getByText(/فاضلّك/)).toHaveTextContent('فاضلّك 3 أختام وتاخد قص ببلاش');
    rerender(<LoyaltyNote loyalty={{ ...loyalty, stamps: 9, left: 0, eligible: true }} />);
    expect(screen.getByText(/المكافأة جاهزة/)).toBeInTheDocument();
  });

  test('الأختام المقفولة ما بتظهرش', () => {
    const { container } = render(<><StampRow loyalty={{ enabled: false }} /><LoyaltyNote loyalty={{ enabled: false }} /></>);
    expect(container).toBeEmptyDOMElement();
  });
});
