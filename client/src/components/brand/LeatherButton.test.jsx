import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LeatherButton } from './index.jsx';

describe('زرار الجلد', () => {
  test('بيشتغل عادي', () => {
    const onClick = vi.fn();
    render(<LeatherButton onClick={onClick}>التالي</LeatherButton>);
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('وهو بيحمّل بيتقفل حتى لو اتبعت disabled={false}', () => {
    render(<LeatherButton loading disabled={false}>التالي</LeatherButton>);
    const button = screen.getByRole('button', { name: 'التالي' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  test('disabled بيقفله', () => {
    render(<LeatherButton disabled>التالي</LeatherButton>);
    expect(screen.getByRole('button', { name: 'التالي' })).toBeDisabled();
  });
});
