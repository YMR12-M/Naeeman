import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Chair from './Chair.jsx';
import { deviceAct, deviceRequest, deviceUpload } from '../lib/device.js';
import { shrinkImage } from '../lib/image.js';

// الجهاز مربوط والحلاق داخل؛ الشبكة كلها متزيّفة
vi.mock('../lib/device.js', () => ({
  readDevice: () => ({ token: 't', device: { id: 1, type: 'chair', name: 'كرسي 1' } }),
  forgetDevice: vi.fn(),
  pairDevice: vi.fn(),
  deviceHeaders: () => ({ 'X-Device-Token': 't' }),
  deviceRequest: vi.fn(),
  deviceAct: vi.fn(),
  deviceBlob: vi.fn(() => Promise.reject(new Error('مفيش صورة في الاختبار'))),
  deviceUpload: vi.fn(),
}));

vi.mock('../lib/image.js', () => ({ shrinkImage: vi.fn(async (file) => file) }));

let view;
const setData = vi.fn((next) => { view = next; });
vi.mock('../lib/live.js', () => ({
  useLive: () => ({ data: view, status: 'live', error: null, refresh: vi.fn(), setData }),
}));

const baseView = () => ({
  barber: { id: 7, name: 'أحمد', chair_no: 1, status: 'available' },
  serving: null,
  waiting_for_me: 1,
  next: [{ id: 11, number: 4, name: 'كريم س.', arrived: true, called: false }],
  services: [{ id: 1, name: 'قص', price: 8000 }],
});

beforeEach(() => {
  view = baseView();
  deviceRequest.mockResolvedValue({ current_barber_id: 7, barbers: [] });
});
afterEach(() => vi.clearAllMocks());

describe('تابلت الكرسي', () => {
  test('«التالي» بيبعت مرّة واحدة بس ولو اتداس مرّتين ورا بعض', async () => {
    let finish;
    deviceAct.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<Chair />);
    const next = await screen.findByRole('button', { name: /التالي/ });

    fireEvent.click(next);
    fireEvent.click(next);
    expect(deviceAct).toHaveBeenCalledTimes(1);
    expect(deviceAct).toHaveBeenCalledWith('chair', '/chair/next', undefined);
    expect(next).toBeDisabled();

    await act(async () => finish({ ...baseView(), serving: { id: 11, number: 4, name: 'كريم س.', services: ['قص'], started_at: new Date().toISOString(), expected_minutes: 25 } }));
    expect(setData).toHaveBeenCalled();
    expect(next).not.toBeDisabled();
  });

  test('الزبون اللي على الكرسي والمدّة المتوقّعة', async () => {
    view = { ...baseView(), serving: { id: 11, number: 4, name: 'كريم س.', services: ['قص', 'دقن'], started_at: new Date().toISOString(), expected_minutes: 40 } };
    render(<Chair />);
    expect(await screen.findByText('كريم س.')).toBeInTheDocument();
    expect(screen.getByText('قص + دقن')).toBeInTheDocument();
    expect(screen.getByText(/المتوقّع حوالي 40 دقيقة/)).toBeInTheDocument();
    // «استراحة» مقفولة طول ما فيه زبون على الكرسي
    expect(screen.getByRole('button', { name: /استراحة/ })).toBeDisabled();
  });

  test('لو الحلاق اتطلّع من مكان تاني بيرجع لاختيار الاسم', async () => {
    deviceAct.mockRejectedValue(Object.assign(new Error('اتطلّعت'), { code: 'CHAIR_SIGNED_OUT' }));
    deviceRequest.mockImplementation(async (_type, path) => (path === '/chair/barbers'
      ? { current_barber_id: 7, barbers: [{ id: 7, name: 'أحمد', has_pin: true }] }
      : null));
    render(<Chair />);
    fireEvent.click(await screen.findByRole('button', { name: /التالي/ }));
    expect(await screen.findByText('مين على الكرسي؟')).toBeInTheDocument();
  });

  test('كارت الزبون: الملاحظات وزرار «صوّر القصّة» وهو على الكرسي', async () => {
    view = {
      ...baseView(),
      serving: {
        id: 11, number: 4, name: 'كريم س.', services: ['قص'], started_at: new Date().toISOString(), expected_minutes: 25,
        card: { id: 5, notes: 'درجة 2 على الجناب', visits: 3, last_photo_id: null, loyalty: { enabled: true, stamps: 9, required: 9, left: 0, eligible: true, reward: 'قص ببلاش' } },
      },
    };
    render(<Chair />);
    expect(await screen.findByText('درجة 2 على الجناب')).toBeInTheDocument();
    expect(screen.getByText(/زيارة رقم/)).toBeInTheDocument();
    expect(screen.getByText(/المكافأة جاهزة: قص ببلاش/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /صوّر القصّة/ })).toBeEnabled();
  });

  test('زبون من غير كارت (من غير موبايل) ما فيهوش تصوير', async () => {
    view = { ...baseView(), serving: { id: 11, number: 4, name: 'كريم س.', services: ['قص'], started_at: new Date().toISOString(), expected_minutes: 25, card: null } };
    render(<Chair />);
    await screen.findByText('كريم س.');
    expect(screen.queryByRole('button', { name: /صوّر/ })).toBeNull();
  });

  test('بعد «خلّصت» الزرار بيعرض صورة اللي لسه خالص، ويرفعها مصغّرة', async () => {
    view = { ...baseView(), recent: { id: 9, number: 3, name: 'سعيد', card_id: 5, has_photo: false } };
    const updated = { ...baseView(), recent: { id: 9, number: 3, name: 'سعيد', card_id: 5, has_photo: true } };
    deviceUpload.mockResolvedValue({ photo: { id: 1 }, view: updated });
    render(<Chair />);
    const button = await screen.findByRole('button', { name: /صوّر قصّة سعيد/ });

    const file = new File(['x'], 'cut.jpg', { type: 'image/jpeg' });
    const input = button.parentElement.querySelector('input[type="file"]');
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });

    expect(shrinkImage).toHaveBeenCalledWith(file);
    expect(deviceUpload).toHaveBeenCalledWith('chair', '/chair/photo', file, { ticket_id: 9 });
    expect(setData).toHaveBeenCalledWith(updated);
  });

  test('اللي اتصوّر خلاص ما بيظهرش له زرار', async () => {
    view = { ...baseView(), recent: { id: 9, number: 3, name: 'سعيد', card_id: 5, has_photo: true } };
    render(<Chair />);
    await screen.findByRole('button', { name: /التالي/ });
    expect(screen.queryByRole('button', { name: /صوّر/ })).toBeNull();
  });
});
