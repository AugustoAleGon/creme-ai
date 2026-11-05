import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AppointmentSummary,
  AssignmentReadiness,
  ReadinessGate,
  ReadinessResponse,
  ScheduleResponse,
  ScheduleResult,
} from '@creme/contracts';
import './styles.css';

const JOB_ORDER_ID = 'JO-2026-0142';
const COORDINATORS = [
  { id: 'u-pedro', name: 'Pedro' },
  { id: 'u-sofia', name: 'Sofía' },
] as const;
type CoordinatorId = (typeof COORDINATORS)[number]['id'];
type LoadState = 'loading' | 'ready' | 'error';
type ResultStatus = ScheduleResult['status'] | 'not_returned';
interface BookingFeedback {
  assignmentId: string;
  workerName: string;
  status: ResultStatus;
  reasons: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isCoordinatorId(value: string): value is CoordinatorId {
  return COORDINATORS.some((coordinator) => coordinator.id === value);
}

function parseGate(value: unknown): ReadinessGate | null {
  if (!isRecord(value) || typeof value.passed !== 'boolean' || !isString(value.reason)) return null;
  return { passed: value.passed, reason: value.reason };
}

function parseAssignment(value: unknown): AssignmentReadiness | null {
  if (!isRecord(value) || !isRecord(value.gates)) return null;
  const employerApproval = parseGate(value.gates.employerApproval);
  const acceptance = parseGate(value.gates.acceptance);
  const documents = parseGate(value.gates.documents);
  const qc = parseGate(value.gates.qc);
  if (!employerApproval || !acceptance || !documents || !qc) return null;
  if (!isString(value.rosterAssignmentId) || !isString(value.workerId) || !isString(value.workerName)) return null;
  if (typeof value.ready !== 'boolean' || !(value.scheduledAppointmentId === null || isString(value.scheduledAppointmentId))) return null;
  return {
    rosterAssignmentId: value.rosterAssignmentId,
    workerId: value.workerId,
    workerName: value.workerName,
    ready: value.ready,
    gates: { employerApproval, acceptance, documents, qc },
    scheduledAppointmentId: value.scheduledAppointmentId,
  };
}

function parseAppointment(value: unknown): AppointmentSummary | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.startsAt)) return null;
  const capacity = value.capacity;
  const remainingCapacity = value.remainingCapacity;
  if (!Number.isFinite(Date.parse(value.startsAt)) || typeof capacity !== 'number' || !Number.isInteger(capacity) || typeof remainingCapacity !== 'number' || !Number.isInteger(remainingCapacity)) return null;
  if (capacity < 0 || remainingCapacity < 0 || remainingCapacity > capacity) return null;
  return { id: value.id, startsAt: value.startsAt, capacity, remainingCapacity };
}

function parseReadiness(value: unknown): ReadinessResponse | null {
  if (!isRecord(value) || value.jobOrderId !== JOB_ORDER_ID) return null;
  if (!(value.currentTermsVersionId === null || isString(value.currentTermsVersionId)) || !Array.isArray(value.assignments) || !Array.isArray(value.appointments)) return null;
  const assignments = value.assignments.map(parseAssignment);
  const appointments = value.appointments.map(parseAppointment);
  if (assignments.some((item) => item === null) || appointments.some((item) => item === null)) return null;
  return {
    jobOrderId: JOB_ORDER_ID,
    currentTermsVersionId: value.currentTermsVersionId,
    assignments: assignments.filter((item): item is AssignmentReadiness => item !== null),
    appointments: appointments.filter((item): item is AppointmentSummary => item !== null),
  };
}

function parseSchedule(value: unknown): ScheduleResponse | null {
  if (!isRecord(value) || !isString(value.appointmentId) || typeof value.remainingCapacity !== 'number' || !Number.isInteger(value.remainingCapacity) || value.remainingCapacity < 0 || !Array.isArray(value.results)) return null;
  const results: ScheduleResult[] = [];
  for (const result of value.results) {
    if (!isRecord(result) || !isString(result.rosterAssignmentId)) return null;
    if (result.status === 'scheduled' || result.status === 'already_scheduled') {
      results.push({ rosterAssignmentId: result.rosterAssignmentId, status: result.status });
    } else if (result.status === 'refused' && Array.isArray(result.reasons) && result.reasons.every(isString)) {
      results.push({ rosterAssignmentId: result.rosterAssignmentId, status: 'refused', reasons: result.reasons });
    } else return null;
  }
  return { appointmentId: value.appointmentId, remainingCapacity: value.remainingCapacity, results };
}

function errorMessage(status?: number): string {
  if (status === 403 || status === 404) return 'Readiness is unavailable for this job order.';
  return 'Could not load worker readiness. Check your connection and try again.';
}

async function fetchJson(url: string, userId: CoordinatorId, signal: AbortSignal, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal,
    headers: { ...(init?.headers ?? {}), 'X-User-Id': userId },
  });
  if (!response.ok) throw Object.assign(new Error('Request failed'), { status: response.status });
  return response.json();
}

function GateCell({ name, gate }: { name: string; gate: ReadinessGate }) {
  return (
    <td>
      <span className={gate.passed ? 'gate gate--pass' : 'gate gate--fail'}>{gate.passed ? 'Pass' : 'Fail'}</span>
      <span className="gate-reason">{gate.reason}</span>
      <span className="sr-only">{name}: {gate.passed ? 'passed' : 'failed'}</span>
    </td>
  );
}

function formatAppointment(appointment: AppointmentSummary): string {
  const date = new Date(appointment.startsAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return `${appointment.id} · ${date} · ${appointment.remainingCapacity} of ${appointment.capacity} seats remaining`;
}

export function App() {
  const [coordinatorId, setCoordinatorId] = useState<CoordinatorId>('u-pedro');
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [appointmentId, setAppointmentId] = useState('');
  const [bookingFeedback, setBookingFeedback] = useState<BookingFeedback[]>([]);
  const [bookingState, setBookingState] = useState<'idle' | 'submitting'>('idle');
  const [retryVersion, setRetryVersion] = useState(0);
  const activeCaller = useRef<CoordinatorId>('u-pedro');
  const appointmentIdRef = useRef('');
  const hasReadiness = useRef(false);
  const identityVersion = useRef(0);
  const bookingLock = useRef(false);
  const loadController = useRef<AbortController | null>(null);
  const bookingController = useRef<AbortController | null>(null);

  const refresh = useCallback(async (caller: CoordinatorId, version: number, keepData: boolean, failureMessage = 'Could not refresh worker readiness. No booking result was confirmed.') => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    try {
      const body = await fetchJson(`/api/job-orders/${JOB_ORDER_ID}/readiness`, caller, controller.signal);
      const parsed = parseReadiness(body);
      if (!parsed) throw new Error('Invalid readiness response');
      if (controller.signal.aborted || identityVersion.current !== version || activeCaller.current !== caller) return false;
      setReadiness(parsed);
      hasReadiness.current = true;
      setLoadState('ready');
      setLoadError('');
      setRefreshError('');
      if (!appointmentIdRef.current || !parsed.appointments.some((item) => item.id === appointmentIdRef.current)) {
        const firstAppointment = parsed.appointments[0]?.id ?? '';
        appointmentIdRef.current = firstAppointment;
        setAppointmentId(firstAppointment);
      }
      return true;
    } catch (error) {
      if (controller.signal.aborted || identityVersion.current !== version || activeCaller.current !== caller) return false;
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : undefined;
      if (keepData && hasReadiness.current) {
        setLoadState('ready');
        setRefreshError(failureMessage);
      } else {
        setLoadError(errorMessage(status));
        setLoadState('error');
      }
      return false;
    }
  }, []);

  useEffect(() => {
    const caller = coordinatorId;
    const version = identityVersion.current;
    void Promise.resolve().then(() => refresh(caller, version, false));
    return () => {
      loadController.current?.abort();
    };
  }, [coordinatorId, refresh, retryVersion]);

  useEffect(() => () => {
    identityVersion.current += 1;
    loadController.current?.abort();
    bookingController.current?.abort();
  }, []);

  function changeCoordinator(value: CoordinatorId) {
    if (value === activeCaller.current) return;
    activeCaller.current = value;
    identityVersion.current += 1;
    bookingLock.current = false;
    loadController.current?.abort();
    bookingController.current?.abort();
    setCoordinatorId(value);
    setReadiness(null);
    hasReadiness.current = false;
    appointmentIdRef.current = '';
    setSelectedIds([]);
    setAppointmentId('');
    setBookingFeedback([]);
    setBookingState('idle');
    setRefreshError('');
    setLoadError('');
    setLoadState('loading');
  }

  function toggleAssignment(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function scheduleSelected() {
    if (bookingLock.current || selectedIds.length === 0 || !appointmentId || loadState !== 'ready') return;
    const caller = activeCaller.current;
    const version = identityVersion.current;
    const selected = [...selectedIds];
    const names = new Map((readiness?.assignments ?? []).map((item) => [item.rosterAssignmentId, item.workerName]));
    const controller = new AbortController();
    bookingController.current = controller;
    bookingLock.current = true;
    setBookingState('submitting');
    setBookingFeedback([]);
    setRefreshError('');
    try {
      const body = await fetchJson(`/api/appointments/${appointmentId}/schedule`, caller, controller.signal, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterAssignmentIds: selected }),
      });
      const parsed = parseSchedule(body);
      if (!parsed || parsed.appointmentId !== appointmentId) throw new Error('Invalid schedule response');
      if (controller.signal.aborted || identityVersion.current !== version || activeCaller.current !== caller) return;
      const byId = new Map(parsed.results.map((item) => [item.rosterAssignmentId, item]));
      setBookingFeedback(selected.map((assignmentId) => {
        const result = byId.get(assignmentId);
        if (!result) return { assignmentId, workerName: names.get(assignmentId) ?? assignmentId, status: 'not_returned', reasons: ['No result was returned. Refresh readiness and check this worker.'] };
        return {
          assignmentId,
          workerName: names.get(assignmentId) ?? assignmentId,
          status: result.status,
          reasons: result.status === 'refused' ? result.reasons : [],
        };
      }));
      setSelectedIds([]);
      setLoadState('loading');
      await refresh(caller, version, true, 'Booking recorded, but readiness could not be refreshed.');
    } catch {
      if (!controller.signal.aborted && identityVersion.current === version && activeCaller.current === caller) {
        setBookingState('idle');
        setRefreshError('Could not schedule the selected workers. No booking result was confirmed. Try again after checking readiness.');
      }
    } finally {
      if (identityVersion.current === version && activeCaller.current === caller) {
        bookingLock.current = false;
        setBookingState('idle');
      }
    }
  }

  const canSchedule = selectedIds.length > 0 && appointmentId.length > 0 && loadState === 'ready' && bookingState === 'idle';

  return (
    <main className="app-shell">
      <header className="page-header">
        <p className="eyebrow">CREME / OPERATIONS</p>
        <div className="header-row">
          <div>
            <h1>Readiness board</h1>
            <p className="intro">Review each worker’s requirements and book ready assignments into a consular appointment.</p>
          </div>
          <label className="coordinator-control">Coordinator
              <select aria-label="Coordinator" value={coordinatorId} onChange={(event) => {
                const nextCoordinator = event.target.value;
                if (isCoordinatorId(nextCoordinator)) changeCoordinator(nextCoordinator);
              }}>
              {COORDINATORS.map((coordinator) => <option key={coordinator.id} value={coordinator.id}>{coordinator.name}</option>)}
            </select>
          </label>
        </div>
      </header>

      {loadState === 'loading' && <output className="notice">Loading worker readiness…</output>}
      {loadState === 'error' && (
        <div role="alert" className="notice notice--error">
          <p>{loadError}</p>
          <button type="button" onClick={() => {
            setLoadError('');
            setLoadState('loading');
            setRetryVersion((value) => value + 1);
          }}>Try again</button>
        </div>
      )}

      {readiness && loadState !== 'error' && (
        <>
          <section className="board-panel" aria-labelledby="board-title">
            <div className="section-heading">
              <div><p className="eyebrow">JOB ORDER</p><h2 id="board-title">{readiness.jobOrderId}</h2></div>
              <p className="terms-note">Current terms: {readiness.currentTermsVersionId ?? 'Not published'}</p>
            </div>
            {readiness.assignments.length === 0 ? (
              <p className="empty-state">No workers are assigned to this job order yet.</p>
            ) : (
              <section className="table-scroll" aria-label="Worker readiness table">
                <table aria-label="Worker readiness">
                  <thead><tr>
                    <th scope="col">Select</th><th scope="col">Worker</th><th scope="col">Readiness</th>
                    <th scope="col">Employer approval</th><th scope="col">Current terms</th><th scope="col">Documents</th><th scope="col">Independent QC</th><th scope="col">Booking</th>
                  </tr></thead>
                  <tbody>{readiness.assignments.map((assignment) => (
                    <tr key={assignment.rosterAssignmentId}>
                      <td><input type="checkbox" aria-label={`Select ${assignment.workerName}`} checked={selectedIds.includes(assignment.rosterAssignmentId)} onChange={() => toggleAssignment(assignment.rosterAssignmentId)} /></td>
                      <th scope="row">{assignment.workerName}</th>
                      <td><span className={assignment.ready ? 'readiness readiness--ready' : 'readiness readiness--blocked'}>{assignment.ready ? 'Ready' : 'Not ready'}</span></td>
                      <GateCell name="Employer approval" gate={assignment.gates.employerApproval} />
                      <GateCell name="Current terms" gate={assignment.gates.acceptance} />
                      <GateCell name="Documents" gate={assignment.gates.documents} />
                      <GateCell name="Independent QC" gate={assignment.gates.qc} />
                      <td>{assignment.scheduledAppointmentId ? `Booked · ${assignment.scheduledAppointmentId}` : 'Not booked'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </section>
            )}
          </section>

          <section className="schedule-panel" aria-labelledby="schedule-title">
            <div><p className="eyebrow">BOOKING</p><h2 id="schedule-title">Schedule selected workers</h2><p>Server readiness is checked again when a booking is submitted.</p></div>
            <label>Appointment
              <select aria-label="Appointment" value={appointmentId} onChange={(event) => {
                appointmentIdRef.current = event.target.value;
                setAppointmentId(event.target.value);
              }}>
                <option value="">Choose an appointment</option>
                {readiness.appointments.map((appointment) => <option key={appointment.id} value={appointment.id}>{formatAppointment(appointment)}</option>)}
              </select>
            </label>
            <button type="button" disabled={!canSchedule} onClick={() => void scheduleSelected()}>
              {bookingState === 'submitting' ? 'Scheduling…' : 'Schedule selected workers'}
            </button>
          </section>

          {refreshError && (
            <div className="notice notice--error" aria-live="polite">
              <output>{refreshError}</output>
              <button type="button" onClick={() => {
                setRefreshError('');
                void refresh(activeCaller.current, identityVersion.current, true, refreshError);
              }}>Retry refresh</button>
            </div>
          )}
          {bookingFeedback.length > 0 && (
            <section className="results-panel" aria-labelledby="results-title">
              <h2 id="results-title">Booking results</h2>
              <ul aria-live="polite" aria-relevant="additions text">
                {bookingFeedback.map((result) => (
                  <li key={result.assignmentId}>
                    <strong>{result.workerName}:</strong> <span className={`result-status result-status--${result.status}`}>{result.status === 'already_scheduled' ? 'Already scheduled' : result.status === 'not_returned' ? 'No result' : result.status === 'scheduled' ? 'Scheduled' : 'Refused'}</span>
                    {result.reasons.length > 0 && <ul className="result-reasons">{result.reasons.map((reason, index) => <li data-result-reason key={`${result.assignmentId}-${index}`}>{reason}</li>)}</ul>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
