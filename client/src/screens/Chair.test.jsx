import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Chair from './Chair.jsx';
import { deviceAct, deviceRequest } from '../lib/device.js';

// الجهاز مربوط والحلاق داخل؛ الشبكة كلها متزيّفة
vi.mock('../lib/device.js', () => ({
  readDevice: () => ({ token: 't', device: { id: 1, type: 'chair', name: 'كرسي 1' } }),
  forgetDevice: vi.fn(),
  pairDevice: vi.fn(),
  deviceHeaders: () => ({ 'X-Device-Token': 't' }),
  deviceRequest: vi.fn(),
  deviceAct: vi.fn(),
}));

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
});
