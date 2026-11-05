import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('reports a failed health check and retries without reloading the page', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Database unavailable' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ok', database: 'connected' }) }));
  render(<App />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('API and PostgreSQL connected')).toBeTruthy();
});

it('shows the API and database connection after the health request succeeds', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'ok', database: 'connected' }),
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  expect(screen.getByRole('status').textContent).toBe('Checking API and database…');
  expect(await screen.findByText('API and PostgreSQL connected')).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.objectContaining({ signal: expect.any(AbortSignal) }));
});
