import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Turn, { headline } from './Turn.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';
import { ConfirmProvider } from '../components/ui/Overlays.jsx';
import { api } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  api: { get: vi.fn(), act: vi.fn(), public: vi.fn(), post: vi.fn() },
  ApiRequestError: class extends Error {},
}));

let view;
const setData = vi.fn((next) => { view = next; });
vi.mock('../lib/live.js', () => ({
  useLive: () => ({ data: view, status: 'live', error: null, refresh: vi.fn(), setData }),
}));

const ticket = (overrides = {}) => ({
  id: 9, number: 14, status: 'waiting', shop: { id: 1, name: 'صالون الأمل', slug: 'elamal' },
  services: [{ name: 'قص', price: 9000 }], total: 9000, preferred_barber: null, barber: null,
  ahead: 3, wait_minutes: 40, unavailable: false, arrived: false, called: false, called_at: null,
  grace_minutes: 10, delays_left: 2, must_confirm: false, confirmed: false, ...overrides,
});

function show(t) {
  view = { version: 1, ticket: t };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <ConfirmProvider>
          <MemoryRouter initialEntries={[`/turn/${t.id}`]}>
            <Routes><Route path="/turn/:id" element={<Turn />} /></Routes>
          </MemoryRouter>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('الجملة تحت الرقم', () => {
  test('كل حالة ليها جملتها', () => {
    expect(headline(ticket()).text).toBe('قدّامك 3');
    expect(headline(ticket({ ahead: 0, arrived: true })).text).toBe('إنت الجاي');
    expect(headline(ticket({ ahead: 0 })).text).toMatch(/اتحرّك/);
    expect(headline(ticket({ ahead: null, unavailable: true })).text).toBe('مستني حلاق يوصل');
    expect(headline(ticket({ status: 'serving', barber: { name: 'حسن' } })).text).toBe('على الكرسي عند أ. حسن');
    expect(headline(ticket({ status: 'done' })).text).toMatch(/نعيمًا/);
    expect(headline(ticket({ status: 'no_show' })).text).toBe('الدور راح عليك');
  });

  test('اتنادى: الدقايق الفاضلة من المهلة', () => {
    const now = Date.parse('2026-10-24T20:00:00Z');
    const called = ticket({ called: true, called_at: '2026-10-24T19:56:00Z' });
    expect(headline(called, now)).toEqual({ text: 'دورك جه! تعالى خلال 6 دقايق', tone: 'alert' });
    expect(headline({ ...called, called_at: '2026-10-24T19:40:00Z' }, now).text).toBe('دورك جه! تعالى حالًا');
  });
});

describe('شاشة «دوري»', () => {
  test('الرقم والجملة والأفعال', () => {
    show(ticket());
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('قدّامك 3')).toBeInTheDocument();
    expect(screen.getByText(/حوالي 40 دقيقة/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /وصلت؟ امسح الكود/ })).toHaveAttribute('href', '/checkin/elamal');
    expect(screen.queryByRole('button', { name: 'جاي' })).toBeNull();
  });

  test('المحل محتاج تأكيد: زرار «جاي» بيبعت مرّة', async () => {
    api.act.mockResolvedValue({ version: 2, ticket: ticket({ must_confirm: true, confirmed: true }) });
    show(ticket({ must_confirm: true }));
    fireEvent.click(screen.getByRole('button', { name: 'جاي' }));
    expect(api.act).toHaveBeenCalledWith('/me/tickets/9/coming');
    expect(await screen.findByText('المحل عرف إنك جاي')).toBeInTheDocument();
  });

  test('«أخّرني» مقفول لما المرّات تخلص', () => {
    show(ticket({ delays_left: 0 }));
    expect(screen.getByRole('button', { name: /أخّرني/ })).toBeDisabled();
  });

  test('«أخّرني» بيسأل الأوّل', async () => {
    api.act.mockResolvedValue({ version: 2, ticket: ticket({ delays_left: 1, ahead: 5 }) });
    show(ticket());
    fireEvent.click(screen.getByRole('button', { name: /أخّرني/ }));
    expect(api.act).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'أخّرني' }));
    await waitFor(() => expect(api.act).toHaveBeenCalledWith('/me/tickets/9/delay'));
  });

  test('الدور خلص: مفيش أفعال، وفيه «خُد دور جديد»', () => {
    show(ticket({ status: 'done' }));
    expect(screen.queryByRole('button', { name: /أخّرني/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'خُد دور جديد' })).toHaveAttribute('href', '/s/elamal');
  });

  test('الدور خلص ومعاه فاتورة: بتظهر بسطورها من غير سطر «الحساب» المكرّر', () => {
    const bill = {
      number: 5, status: 'paid', subtotal: 9000, discount: 0, reward_discount: 0, total: 9000, tip: 0, paid: 9000, refunded: 0,
      stamp_awarded: true, reward_redeemed: false,
      items: [{ kind: 'service', name: 'قص', qty: 1, unit_price: 9000, line_total: 9000 }],
      payments: [{ label: 'كاش', amount: 9000, kind: 'payment' }],
    };
    show(ticket({ status: 'done', bill, photo_ids: [] }));
    expect(screen.getByText('اتدفعت')).toBeInTheDocument();
    expect(screen.getByText(/اتضاف ختم على كارتك/)).toBeInTheDocument();
    expect(screen.queryByText(/^الحساب/)).toBeNull();
  });
});
