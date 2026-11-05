import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('operations endpoints (R8–R12)', () => {
  let app: INestApplication;
  let admin: Pool;
  let database: Pool;
  let databaseName: string;
  let created = false;
  const originalUrl = process.env.DATABASE_URL;

  beforeEach(async () => {
    created = false;
    const configured = process.env.TEST_DATABASE_URL;
    if (!configured || !new URL(configured).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a dedicated *_test database.');
    const url = new URL(configured);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Local PostgreSQL required.');
    databaseName = `creme_${randomUUID().replaceAll('-', '')}_test`;
    admin = new Pool({ connectionString: configured, max: 1 });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    url.pathname = `/${databaseName}`;
    process.env.DATABASE_URL = url.toString();
    database = new Pool({ connectionString: url.toString(), max: 2 });
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../src/database/cli.js', import.meta.url)), 'seed'], { env: process.env, timeout: 15000 });
    app = await createApp();
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    await database?.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin?.end();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });
  const get = (user: string, path: string) => request(app.getHttpServer()).get(path).set('X-User-Id', user);
  const post = (user: string, path: string, body: object) => request(app.getHttpServer()).post(path).set('X-User-Id', user).send(body);
  const readiness = (user = 'u-pedro') => get(user, '/api/job-orders/JO-2026-0142/readiness');
  const submit = (body: object, user: string) => post(user, '/api/mobile/submissions', body);
  const review = (id: string, body: object, user = 'u-luis') => post(user, `/api/document-versions/${id}/review`, body);
  const schedule = (ids: string[], appointment = 'APT-1', user = 'u-pedro') => post(user, `/api/appointments/${appointment}/schedule`, { rosterAssignmentIds: ids });
  const state = async () => JSON.stringify((await database.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM employer_decisions e) employers,
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM acceptances a) acceptances,
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM appointment_memberships m) memberships,
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_log a WHERE entity IN ('employer_decision','acceptance','appointment_membership')) audit`)).rows);

  it('returns all four seeded gates and only the two ready assignments (R8)', async () => {
    const response = await readiness();
    expect(response.status).toBe(200);
    expect(response.body.assignments.filter((row: { ready: boolean }) => row.ready).map((row: { rosterAssignmentId: string }) => row.rosterAssignmentId)).toEqual(['RA-1', 'RA-6']);
    expect(response.body.assignments[0].gates).toEqual({
      employerApproval: { passed: true, reason: 'Employer approval recorded.' },
      acceptance: { passed: true, reason: 'Current terms accepted.' },
      documents: { passed: true, reason: 'All required documents are present.' },
      qc: { passed: true, reason: 'All active documents are approved.' },
    });
    expect(response.body.appointments[0]).toMatchObject({ id: 'APT-1', capacity: 2, remainingCapacity: 2 });
  });

  it('records employer decisions and acceptance idempotently with represented-worker audit', async () => {
    const before = await state();
    const invalidWorkerVerbal = await post('w-4', '/api/roster-assignments/RA-4/acceptance', { termsVersionId: 'TERMS-2', method: 'verbal' });
    expect(invalidWorkerVerbal.status).toBe(403);
    expect(await state()).toBe(before);
    const decision = await post('u-pedro', '/api/roster-assignments/RA-4/employer-decision', { evidence: 'verbal', decidedOn: '2026-11-05' });
    expect(decision.status).toBe(200);
    expect(decision.body).toEqual({ rosterAssignmentId: 'RA-4', decision: 'approved', evidence: 'verbal', decidedOn: '2026-11-05' });
    const repeatedDecision = await post('u-pedro', '/api/roster-assignments/RA-4/employer-decision', { evidence: 'verbal', decidedOn: '2026-11-05' });
    expect(repeatedDecision.status).toBe(200);
    await database.query("DELETE FROM acceptances WHERE roster_assignment_id='RA-4' AND terms_version_id='TERMS-2'");
    const oldAcceptance = await post('w-4', '/api/roster-assignments/RA-4/acceptance', { termsVersionId: 'TERMS-1', method: 'in_app' });
    expect(oldAcceptance.status).toBe(200);
    expect((await readiness()).body.assignments.find((row: { rosterAssignmentId: string }) => row.rosterAssignmentId === 'RA-4').gates.acceptance.passed).toBe(false);
    const acceptance = await post('u-pedro', '/api/roster-assignments/RA-4/acceptance', { termsVersionId: 'TERMS-2', method: 'verbal' });
    expect(acceptance.status).toBe(200);
    expect((await database.query("SELECT actor_id,on_behalf_of_user_id FROM audit_log WHERE entity='acceptance' AND field='created' ORDER BY created_at")).rows).toEqual([
      { actor_id: 'w-4', on_behalf_of_user_id: null }, { actor_id: 'u-pedro', on_behalf_of_user_id: 'w-4' },
    ]);
    expect(await state()).not.toBe(before);
    const repeatedAcceptance = await post('u-pedro', '/api/roster-assignments/RA-4/acceptance', { termsVersionId: 'TERMS-2', method: 'verbal' });
    expect(repeatedAcceptance.body).toEqual(acceptance.body);
    const changed = await post('u-pedro', '/api/roster-assignments/RA-4/employer-decision', { evidence: 'document', decidedOn: '2026-11-06' });
    expect(changed.status).toBe(200);
    expect((await database.query("SELECT count(*)::int AS count FROM employer_decisions WHERE roster_assignment_id='RA-4'")).rows).toEqual([{ count: 2 }]);
    expect((await database.query("SELECT count(*)::int AS count FROM audit_log WHERE entity='employer_decision' AND field='created'")).rows).toEqual([{ count: 2 }]);
  });

  it('partially schedules ready assignments, refuses the rest, and prevents overbooking (R9–R10)', async () => {
    const response = await schedule(['RA-1', 'RA-3', 'RA-4', 'RA-6', 'RA-1']);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ appointmentId: 'APT-1', remainingCapacity: 0, results: [
      { rosterAssignmentId: 'RA-1', status: 'scheduled' },
      { rosterAssignmentId: 'RA-3', status: 'refused', reasons: ['Current terms have not been accepted.'] },
      { rosterAssignmentId: 'RA-4', status: 'refused', reasons: ['Employer approval is missing.'] },
      { rosterAssignmentId: 'RA-6', status: 'scheduled' },
    ] });
    const after = await state();
    const duplicate = await schedule(['RA-1'], 'APT-1');
    expect(duplicate.body.results).toEqual([{ rosterAssignmentId: 'RA-1', status: 'already_scheduled' }]);
    expect(await state()).toBe(after);
    expect((await schedule(['RA-1'], 'APT-2')).body.results[0]).toMatchObject({ rosterAssignmentId: 'RA-1', status: 'refused' });
  });



  it('uses approved active versions for readiness after QC, resubmission, and conflicting upload (R6–R8)', async () => {
    expect((await readiness()).body.assignments.find((row: { rosterAssignmentId: string }) => row.rosterAssignmentId === 'RA-2').ready).toBe(false);
    expect((await review('DOC-w-2-passport-1', { decision: 'approve' })).status).toBe(200);
    expect((await readiness()).body.assignments.find((row: { rosterAssignmentId: string }) => row.rosterAssignmentId === 'RA-2').ready).toBe(true);
    const body = { clientSubmissionId: 't3-elena', rosterAssignmentId: 'RA-5', documentType: 'passport', fields: { documentNumber: 'fixed', expiresOn: '2030-01-01' }, fileRef: 'phone://fixed' };
    const upload = await submit(body, 'w-5');
    expect(upload.status).toBe(201);
    const afterUpload = (await readiness()).body.assignments.find((row: { rosterAssignmentId: string }) => row.rosterAssignmentId === 'RA-5');
    expect(afterUpload.ready).toBe(false);
    expect(afterUpload.gates.qc.passed).toBe(false);
    expect((await review(upload.body.documentVersionId, { decision: 'approve' })).status).toBe(200);
    expect((await readiness()).body.assignments.find((row: { rosterAssignmentId: string }) => row.rosterAssignmentId === 'RA-5').ready).toBe(true);
    const conflict = await submit({ ...body, clientSubmissionId: 't3-ana', rosterAssignmentId: 'RA-1', fields: { documentNumber: 'different', expiresOn: '2030-01-01' } }, 'w-1');
    expect(conflict.status).toBe(201);
    const ana = (await readiness()).body.assignments.find((row: { rosterAssignmentId: string }) => row.rosterAssignmentId === 'RA-1');
    expect(ana.ready).toBe(true);
    expect(ana.gates.qc.passed).toBe(true);
  });

  it('allows only one successful worker at capacity one under concurrent calls (R10)', async () => {
    const [first, second] = await Promise.all([schedule(['RA-1'], 'APT-2'), schedule(['RA-6'], 'APT-2')]);
    expect([first, second].flatMap((response) => response.body.results.map((row: { status: string }) => row.status)).sort()).toEqual(['refused', 'scheduled']);
    expect((await database.query("SELECT count(*)::int AS count FROM appointment_memberships WHERE appointment_id='APT-2' AND status='scheduled'")).rows).toEqual([{ count: 1 }]);
  });

  it('rolls back booking and audit together when the audit insert fails (R3/R9)', async () => {
    await database.query(`CREATE FUNCTION fail_operations_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test-only audit failure'; END $$;
      CREATE TRIGGER fail_operations_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.entity = 'appointment_membership') EXECUTE FUNCTION fail_operations_audit()`);
    const before = await database.query("SELECT count(*)::int AS count FROM appointment_memberships WHERE status='scheduled'");
    const response = await schedule(['RA-1']);
    expect(response.status).toBe(500);
    expect((await database.query("SELECT count(*)::int AS count FROM appointment_memberships WHERE status='scheduled'")).rows).toEqual(before.rows);
    await database.query('DROP TRIGGER fail_operations_audit ON audit_log; DROP FUNCTION fail_operations_audit()');
    expect((await schedule(['RA-1'])).body.results[0].status).toBe('scheduled');
  });

  it('serializes same-assignment booking races across appointments (R10)', async () => {
    const [first, second] = await Promise.all([schedule(['RA-1'], 'APT-1'), schedule(['RA-1'], 'APT-2')]);
    const statuses = [first.body.results[0].status, second.body.results[0].status];
    expect(statuses.filter((status) => status === 'scheduled')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'refused')).toHaveLength(1);
    expect((await database.query("SELECT count(*)::int AS count FROM appointment_memberships WHERE roster_assignment_id='RA-1' AND status='scheduled'")).rows).toEqual([{ count: 1 }]);
  });

  it('fails closed for branch, role, malformed input and inaccessible orders', async () => {
    expect((await readiness('u-sofia')).status).toBe(404);
    expect((await readiness('w-1')).status).toBe(403);
    expect((await readiness('unknown')).status).toBe(403);
    expect((await get('u-pedro', '/api/job-orders/missing/readiness')).status).toBe(404);
    expect((await schedule([], 'APT-1')).status).toBe(400);
    expect((await post('u-pedro', '/api/roster-assignments/RA-4/employer-decision', { evidence: 'verbal', decidedOn: '2026-02-30' })).status).toBe(400);
    expect((await post('u-sofia', '/api/appointments/APT-1/schedule', { rosterAssignmentIds: ['RA-1'] })).status).toBe(404);
  });

  it('fails closed when an order has no current terms (R8/R11)', async () => {
    await database.query("UPDATE terms_versions SET status='superseded' WHERE id='TERMS-2'");
    const response = await readiness();
    expect(response.body.currentTermsVersionId).toBeNull();
    expect(response.body.assignments.every((row: { gates: { acceptance: { passed: boolean } } }) => !row.gates.acceptance.passed)).toBe(true);
  });

  it('rechecks current terms and preserves existing bookings when terms change (R11)', async () => {
    expect((await schedule(['RA-1'])).body.results[0].status).toBe('scheduled');
    await database.query("UPDATE terms_versions SET status='superseded' WHERE id='TERMS-2'; INSERT INTO terms_versions (id,job_order_id,version,status,content) VALUES ('TERMS-3','JO-2026-0142',3,'current','new terms')");
    const response = await readiness();
    expect(response.body.assignments.find((row: { rosterAssignmentId: string }) => row.rosterAssignmentId === 'RA-1').gates.acceptance).toEqual({ passed: false, reason: 'Current terms have not been accepted.' });
    expect(response.body.assignments.find((row: { rosterAssignmentId: string }) => row.rosterAssignmentId === 'RA-1').scheduledAppointmentId).toBe('APT-1');
  });
});
