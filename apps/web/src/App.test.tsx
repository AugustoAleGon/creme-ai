import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';

const gate = (passed: boolean, reason: string) => ({ passed, reason });
const readiness = {
  jobOrderId: 'JO-2026-0142',
  currentTermsVersionId: 'terms-v2',
  assignments: [
    {
      rosterAssignmentId: 'ra-1', workerId: 'w-1', workerName: 'Ana López', ready: true,
      gates: {
        employerApproval: gate(true, 'Employer approved'), acceptance: gate(true, 'Current terms accepted'),
        documents: gate(true, 'All required documents approved'), qc: gate(true, 'Independent QC approved'),
      }, scheduledAppointmentId: null,
    },
    {
      rosterAssignmentId: 'ra-2', workerId: 'w-2', workerName: 'Bruno Díaz', ready: false,
      gates: {
        employerApproval: gate(true, 'Employer approved'), acceptance: gate(true, 'Current terms accepted'),
        documents: gate(true, 'All required documents approved'), qc: gate(false, 'Passport is awaiting review'),
      }, scheduledAppointmentId: null,
    },
  ],
  appointments: [
    { id: 'APT-1', startsAt: '2026-12-04T14:00:00.000Z', capacity: 2, remainingCapacity: 1 },
    { id: 'APT-2', startsAt: '2026-12-05T14:00:00.000Z', capacity: 1, remainingCapacity: 1 },
  ],
};

function response(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows the assignment table, four gate outcomes, appointments, and remaining capacity', async () => {
  const fetchMock = vi.fn().mockResolvedValue(response(readiness));
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);

  expect(await screen.findByRole('table', { name: 'Worker readiness' })).toBeTruthy();
  expect(screen.getByRole('columnheader', { name: 'Employer approval' })).toBeTruthy();
  expect(screen.getByText('Passport is awaiting review')).toBeTruthy();
  expect(screen.getByText('Not ready')).toBeTruthy();
  expect(screen.getByRole('option', { name: /APT-1/ }).textContent).toContain('1 of 2 seats remaining');
  expect(fetchMock).toHaveBeenCalledWith('/api/job-orders/JO-2026-0142/readiness', expect.objectContaining({
    headers: { 'X-User-Id': 'u-pedro' }, signal: expect.any(AbortSignal),
  }));
});

it('submits mixed readiness selections, shows each partial result, then refreshes server state', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response(readiness))
    .mockResolvedValueOnce(response({
      appointmentId: 'APT-1', remainingCapacity: 0,
      results: [
        { rosterAssignmentId: 'ra-1', status: 'scheduled' },
        { rosterAssignmentId: 'ra-2', status: 'refused', reasons: ['Passport is awaiting review'] },
      ],
    }))
    .mockResolvedValueOnce(response({ ...readiness, appointments: readiness.appointments.map((item) => ({ ...item, remainingCapacity: item.id === 'APT-1' ? 0 : 1 })) }));
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  await screen.findByRole('table', { name: 'Worker readiness' });

  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ana López' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bruno Díaz' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Appointment' }), { target: { value: 'APT-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Schedule selected workers' }));

  expect(await screen.findByText('Scheduled')).toBeTruthy();
  expect(screen.getByText('Refused')).toBeTruthy();
  expect(screen.getByText('Passport is awaiting review', { selector: '[data-result-reason]' })).toBeTruthy();
  expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/appointments/APT-1/schedule', expect.objectContaining({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'u-pedro' },
    body: JSON.stringify({ rosterAssignmentIds: ['ra-1', 'ra-2'] }),
  }));
  expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/job-orders/JO-2026-0142/readiness', expect.objectContaining({ headers: { 'X-User-Id': 'u-pedro' } }));
  expect((await screen.findByRole('option', { name: /APT-1/ })).textContent).toContain('0 of 2 seats remaining');
});

it('keeps booking outcomes visible when the post-booking readiness refresh fails', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response(readiness))
    .mockResolvedValueOnce(response({ appointmentId: 'APT-1', remainingCapacity: 0, results: [{ rosterAssignmentId: 'ra-1', status: 'scheduled' }] }))
    .mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  await screen.findByRole('table', { name: 'Worker readiness' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ana López' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Appointment' }), { target: { value: 'APT-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Schedule selected workers' }));

  expect(await screen.findByText('Booking recorded, but readiness could not be refreshed.')).toBeTruthy();
  expect(screen.getByText('Scheduled')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }));
  expect(await screen.findByText('Booking recorded, but readiness could not be refreshed.')).toBeTruthy();
  expect(screen.getByText('Scheduled')).toBeTruthy();
});

it('does not confirm a failed booking when readiness retries also fail', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response(readiness))
    .mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  await screen.findByRole('table', { name: 'Worker readiness' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ana López' }));
  fireEvent.click(screen.getByRole('button', { name: 'Schedule selected workers' }));

  const unconfirmed = 'Could not schedule the selected workers. No booking result was confirmed. Try again after checking readiness.';
  expect(await screen.findByText(unconfirmed)).toBeTruthy();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }));
    expect(await screen.findByText(unconfirmed)).toBeTruthy();
    expect(screen.queryByText(/Booking recorded/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Booking results' })).toBeNull();
    expect(screen.getByRole('table', { name: 'Worker readiness' })).toBeTruthy();
  }
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

it('shows loading and generic access errors, then retries without a page reload', async () => {
  let retry: ((value: ReturnType<typeof response>) => void) | undefined;
  const fetchMock = vi.fn()
    .mockRejectedValueOnce(Object.assign(new Error('forbidden details'), { status: 403 }))
    .mockImplementationOnce(() => new Promise((resolve) => { retry = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);

  expect((await screen.findByRole('alert')).textContent).toContain('Readiness is unavailable for this job order.');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect((await screen.findByRole('status')).textContent).toContain('Loading worker readiness');
  retry?.(response({ ...readiness, assignments: [] }));
  expect(await screen.findByText('No workers are assigned to this job order yet.')).toBeTruthy();
});

it('disables scheduling without a selection or appointment and prevents duplicate submissions', async () => {
  let resolveBooking: ((value: ReturnType<typeof response>) => void) | undefined;
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response(readiness))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveBooking = resolve; }))
    .mockResolvedValueOnce(response(readiness));
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  await screen.findByRole('table', { name: 'Worker readiness' });
  const button = screen.getByRole('button', { name: 'Schedule selected workers' });
  expect(button.hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ana López' }));
  expect(button.hasAttribute('disabled')).toBe(false);
  fireEvent.click(button);
  fireEvent.click(button);
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/appointments/APT-1/schedule')).toHaveLength(1);
  resolveBooking?.(response({ appointmentId: 'APT-1', remainingCapacity: 0, results: [{ rosterAssignmentId: 'ra-1', status: 'scheduled' }] }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
});

it('clears Pedro records immediately on caller switch and ignores his late response', async () => {
  let resolvePedro: ((value: ReturnType<typeof response>) => void) | undefined;
  const fetchMock = vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { resolvePedro = resolve; }))
    .mockResolvedValueOnce(response({ ...readiness, assignments: [{ ...readiness.assignments[0], workerName: 'Sofía Worker' }] }));
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);

  fireEvent.change(screen.getByRole('combobox', { name: 'Coordinator' }), { target: { value: 'u-sofia' } });
  expect(screen.queryByText('Ana López')).toBeNull();
  expect(await screen.findByText('Sofía Worker')).toBeTruthy();
  resolvePedro?.(response(readiness));
  await waitFor(() => expect(screen.queryByText('Ana López')).toBeNull());
  expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/job-orders/JO-2026-0142/readiness', expect.objectContaining({ headers: { 'X-User-Id': 'u-sofia' } }));
});

it('ignores a booking response that arrives after switching coordinators', async () => {
  let resolveBooking: ((value: ReturnType<typeof response>) => void) | undefined;
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response(readiness))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveBooking = resolve; }))
    .mockResolvedValueOnce(response({ ...readiness, assignments: [{ ...readiness.assignments[0], workerName: 'Sofía Worker' }] }));
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  await screen.findByRole('table', { name: 'Worker readiness' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ana López' }));
  fireEvent.click(screen.getByRole('button', { name: 'Schedule selected workers' }));

  fireEvent.change(screen.getByRole('combobox', { name: 'Coordinator' }), { target: { value: 'u-sofia' } });
  expect(screen.queryByText('Ana López')).toBeNull();
  expect(await screen.findByText('Sofía Worker')).toBeTruthy();
  resolveBooking?.(response({ appointmentId: 'APT-1', remainingCapacity: 0, results: [{ rosterAssignmentId: 'ra-1', status: 'scheduled' }] }));
  await waitFor(() => expect(screen.queryByText('Scheduled')).toBeNull());
  expect(screen.queryByText('Ana López')).toBeNull();
});
