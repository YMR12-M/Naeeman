import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LinkCard } from './Account.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  api: { post: vi.fn() },
}));

const show = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <ToastProvider><LinkCard /></ToastProvider>
  </QueryClientProvider>,
);

afterEach(() => vi.clearAllMocks());

describe('ربط كارت المحل بكود من الاستقبال', () => {
  test('الكود بالأرقام العربي بيتبعت 6 أرقام إنجليزي، والكارت بيتربط', async () => {
    api.post.mockResolvedValue({ id: 3, shop_name: 'صالون الأمل', loyalty: { enabled: true } });
    show();
    fireEvent.click(screen.getByText(/عندك كارت في محل/));
    fireEvent.change(screen.getByLabelText('الكود'), { target: { value: '١٢٣٤٥٦' } });
    fireEvent.click(screen.getByText('اربط'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/me/cards/link', { code: '123456' }));
    expect(await screen.findByText(/صالون الأمل/)).toBeInTheDocument();
  });

  test('كود ناقص ما بيتبعتش، وغلط السيرفر بيظهر', async () => {
    api.post.mockRejectedValue(Object.assign(new Error('الكود غلط أو انتهى — اطلب كود جديد من المحل'), { code: 'LINK_INVALID' }));
    show();
    fireEvent.click(screen.getByText(/عندك كارت في محل/));
    fireEvent.change(screen.getByLabelText('الكود'), { target: { value: '123' } });
    fireEvent.click(screen.getByText('اربط'));
    expect(await screen.findByText('الكود 6 أرقام')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('الكود'), { target: { value: '999999' } });
    fireEvent.click(screen.getByText('اربط'));
    expect(await screen.findByText(/الكود غلط أو انتهى/)).toBeInTheDocument();
  });
});
