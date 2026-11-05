import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.js';

// Agreed seam: HTTP responses and persisted effects in a disposable real database.
describe('document workflow (R2–R7, R12)', () => {
  let app: INestApplication;
  let admin: Pool;
  let database: Pool;
  let databaseName: string;
  let created = false;
  const originalUrl = process.env.DATABASE_URL;

  beforeEach(async () => {
    created = false;
    const configured = process.env.TEST_DATABASE_URL;
    if (!configured || !new URL(configured).pathname.endsWith('_test')) {
      throw new Error('TEST_DATABASE_URL must point to a dedicated *_test database.');
    }
    const url = new URL(configured);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Local PostgreSQL required.');
    databaseName = `creme_${randomUUID().replaceAll('-', '')}_test`;
    admin = new Pool({ connectionString: configured, max: 1 });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    url.pathname = `/${databaseName}`;
    process.env.DATABASE_URL = url.toString();
    database = new Pool({ connectionString: url.toString(), max: 2 });
    await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL('../src/database/cli.js', import.meta.url)), 'seed',
    ], { env: process.env, timeout: 15000 });
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

  const submission = {
    clientSubmissionId: 'offline-1', rosterAssignmentId: 'RA-5', documentType: 'passport',
    fields: { documentNumber: 'corrected', expiresOn: '2030-01-01' }, fileRef: 'phone://corrected',
  };
  function submit(body: object = submission, user = 'w-5') {
    return request(app.getHttpServer()).post('/api/mobile/submissions').set('X-User-Id', user).send(body);
  }
  function review(id: string, body: object = { decision: 'approve' }, user = 'u-luis') {
    return request(app.getHttpServer()).post(`/api/document-versions/${id}/review`).set('X-User-Id', user).send(body);
  }
  async function snapshot() {
    const result = await database.query(`SELECT jsonb_build_object(
      'documents', (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM document_versions d),
      'reviews', (SELECT jsonb_agg(to_jsonb(q) ORDER BY id) FROM qc_reviews q),
      'tasks', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM tasks t),
      'receipts', (SELECT jsonb_agg(to_jsonb(r) ORDER BY user_id, client_submission_id) FROM submission_receipts r),
      'audit', (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_log a)) AS state`);
    return JSON.stringify(result.rows);
  }

  it('stores a new pending version and returns the original result on replay without history changes (R2–R5)', async () => {
    const first = await submit();
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ documentVersionId: expect.any(String), version: 2, status: 'pending_review', conflict: false });
    const stored = await snapshot();
    const replay = await submit();
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(await snapshot()).toBe(stored);
    expect((await database.query("SELECT version FROM document_versions WHERE roster_assignment_id='RA-5' AND document_type='passport' ORDER BY version")).rows)
      .toEqual([{ version: 1 }, { version: 2 }]);
    expect((await database.query('SELECT decision FROM qc_reviews WHERE document_version_id=$1', [first.body.documentVersionId])).rows).toEqual([]);
    expect((await database.query("SELECT status FROM tasks WHERE id='TASK-ELENA-PASSPORT'")).rows).toEqual([{ status: 'open' }]);
    expect((await database.query("SELECT actor_id, on_behalf_of_user_id, entity, old_value FROM audit_log WHERE field = 'created' ORDER BY entity")).rows)
      .toEqual([{ actor_id: 'w-5', on_behalf_of_user_id: null, entity: 'document_version', old_value: null }]);
  });
  it('preserves approved data, deduplicates conflicts and serializes simultaneous offline replay (R5/R6)', async () => {
    const body = { ...submission, rosterAssignmentId: 'RA-1' };
    const [first, replay] = await Promise.all([submit(body, 'w-1'), submit(body, 'w-1')]);
    expect([first.status, replay.status]).toEqual([201, 201]);
    expect(first.body).toEqual(replay.body);
    expect(first.body.conflict).toBe(true);
    expect((await database.query("SELECT version FROM document_versions WHERE roster_assignment_id='RA-1' AND document_type='passport' ORDER BY version")).rows)
      .toEqual([{ version: 1 }, { version: 2 }]);
    expect((await database.query("SELECT d.version FROM document_versions d JOIN qc_reviews q ON q.document_version_id=d.id WHERE d.roster_assignment_id='RA-1' AND d.document_type='passport' AND q.decision='approve' ORDER BY d.version DESC LIMIT 1")).rows)
      .toEqual([{ version: 1 }]);
    const snapshotBeforeConflict = await snapshot();
    expect((await submit({ ...body, fileRef: 'changed' }, 'w-1')).status).toBe(409);
    expect(await snapshot()).toBe(snapshotBeforeConflict);
    expect((await submit({ ...body, clientSubmissionId: 'offline-2' }, 'w-1')).status).toBe(201);
    expect((await database.query("SELECT owner_id, status FROM tasks WHERE roster_assignment_id='RA-1'")).rows)
      .toEqual([{ owner_id: 'u-marta', status: 'open' }]);
    expect((await database.query("SELECT entity, count(*)::int AS count FROM audit_log WHERE field='created' GROUP BY entity ORDER BY entity")).rows)
      .toEqual([{ entity: 'document_version', count: 2 }, { entity: 'task', count: 1 }]);
  });

  it('requires independent QC and one final decision per immutable version (R7)', async () => {
    const id = 'DOC-w-2-passport-1';
    const before = await snapshot();
    expect((await review(id, { decision: 'approve' }, 'u-rosa')).status).toBe(403);
    expect(await snapshot()).toBe(before);
    const approved = await review(id);
    expect(approved.status).toBe(200);
    expect(approved.body).toEqual({ documentVersionId: id, status: 'approved' });
    const after = await snapshot();
    expect((await review(id, { decision: 'reject', reason: 'Too late' })).status).toBe(409);
    expect(await snapshot()).toBe(after);
  });

  it('opens a rejection task, keeps it through resubmission and resolves it only after fresh approval (R3/R4/R7)', async () => {
    const rejection = await review('DOC-w-2-passport-1', { decision: 'reject', reason: 'Unreadable' });
    expect(rejection.status).toBe(200);
    expect(rejection.body.status).toBe('rejected');
    expect((await database.query("SELECT owner_id, status, reason FROM tasks WHERE roster_assignment_id='RA-2'")).rows)
      .toEqual([{ owner_id: 'u-marta', status: 'open', reason: 'Unreadable' }]);
    const upload = await submit({ ...submission, rosterAssignmentId: 'RA-2' }, 'w-2');
    expect(upload.status).toBe(201);
    expect(upload.body.status).toBe('pending_review');
    expect((await database.query('SELECT decision FROM qc_reviews WHERE document_version_id=$1', [upload.body.documentVersionId])).rows).toEqual([]);
    expect((await database.query("SELECT status FROM tasks WHERE roster_assignment_id='RA-2'")).rows).toEqual([{ status: 'open' }]);
    expect((await review(upload.body.documentVersionId)).status).toBe(200);
    const afterApproval = await snapshot();
    const replay = await submit({ ...submission, rosterAssignmentId: 'RA-2' }, 'w-2');
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(upload.body);
    expect(await snapshot()).toBe(afterApproval);
    expect((await database.query("SELECT status, resolved_at IS NOT NULL AS resolved FROM tasks WHERE roster_assignment_id='RA-2'")).rows)
      .toEqual([{ status: 'resolved', resolved: true }]);
    expect((await database.query("SELECT old_value->>'status' AS old, new_value->>'status' AS new, actor_id FROM audit_log WHERE entity='task' AND field='status'")).rows)
      .toEqual([{ old: 'open', new: 'resolved', actor_id: 'u-luis' }]);
    expect((await database.query("SELECT q.decision FROM document_versions d JOIN qc_reviews q ON q.document_version_id=d.id WHERE d.roster_assignment_id='RA-2' AND d.document_type='passport' ORDER BY d.version")).rows)
      .toEqual([{ decision: 'reject' }, { decision: 'approve' }]);
  });

  it('fails closed for unknown users, roles, ownership, branch and archived records before replay (R12)', async () => {
    const accepted = await submit();
    expect(accepted.status).toBe(201);
    await database.query("INSERT INTO user_roles (user_id,role) VALUES ('u-sofia','qc_reviewer')");
    await database.query("INSERT INTO user_roles (user_id,role) VALUES ('w-5','qc_reviewer')");
    const before = await snapshot();
    for (const user of ['', 'missing', 'u-marta', 'u-luis', 'u-pedro']) {
      const response = await submit(submission, user);
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ statusCode: 403, error: 'Forbidden', message: 'Caller and required role are required' });
    }
    expect((await submit(submission, 'w-1')).status).toBe(404);
    expect((await submit({ ...submission, rosterAssignmentId: 'missing' })).status).toBe(404);
    for (const user of ['', 'missing', 'u-marta', 'w-1']) {
      expect((await review('DOC-w-2-passport-1', { decision: 'approve' }, user)).status).toBe(403);
    }
    expect((await review('DOC-w-2-passport-1', { decision: 'approve' }, 'u-sofia')).status).toBe(404);
    // The submitting worker cannot review their own upload, even with both roles.
    await database.query("UPDATE users SET branch_id='norte' WHERE id='w-5'");
    expect((await review(accepted.body.documentVersionId, { decision: 'approve' }, 'w-5')).status).toBe(403);
    expect((await review('missing')).status).toBe(404);
    await database.query("UPDATE users SET status='archived' WHERE id='w-5'");
    expect((await submit()).status).toBe(403);
    await database.query("UPDATE users SET status='active' WHERE id='w-5'");
    await database.query("UPDATE roster_assignments SET status='archived' WHERE id='RA-5'");
    expect((await submit()).status).toBe(404);
    expect((await review(accepted.body.documentVersionId)).status).toBe(404);
    await database.query("UPDATE roster_assignments SET status='active' WHERE id='RA-5'");
    await database.query("UPDATE workers SET archived_at=now() WHERE id='w-5'");
    expect((await submit()).status).toBe(404);
    await database.query("UPDATE workers SET archived_at=NULL WHERE id='w-5'");
    await database.query("UPDATE job_orders SET status='cancelled'");
    expect((await submit()).status).toBe(404);
    expect((await review('DOC-w-2-passport-1')).status).toBe(404);
    expect(await snapshot()).toBe(before);
  });

  it('rejects malformed inputs without writes and treats normalized fields, not file references, as conflicts', async () => {
    const before = await snapshot();
    for (const body of [
      {}, { ...submission, clientSubmissionId: '' }, { ...submission, fields: [] },
      { ...submission, fields: { documentNumber: 7 } }, { ...submission, fields: {} },
      { ...submission, fileRef: ' ' }, { ...submission, documentType: 'unknown' },
      { ...submission, capturedBy: 'u-luis' },
    ]) expect((await submit(body)).status).toBe(400);
    for (const body of [{}, { decision: 'reject' }, { decision: 'reject', reason: ' ' }, { decision: 'unknown' }, { decision: 'approve', reviewerId: 'u-rosa' }]) {
      expect((await review('DOC-w-2-passport-1', body)).status).toBe(400);
    }
    expect(await snapshot()).toBe(before);
    const normalized = { ...submission, rosterAssignmentId: 'RA-1', fields: { documentNumber: ' passport-w-1 ', expiresOn: '2030-01-01' } };
    const first = await submit(normalized, 'w-1');
    expect(first.status).toBe(201);
    expect(first.body.conflict).toBe(false);
    const saved = await snapshot();
    const replay = await submit({ ...normalized, fields: { expiresOn: '2030-01-01', documentNumber: 'passport-w-1' } }, 'w-1');
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(await snapshot()).toBe(saved);
    expect((await database.query("SELECT id FROM tasks WHERE roster_assignment_id='RA-1'")).rows).toEqual([]);
  });

  it('rolls back documents, receipts, tasks and reviews if their transactional audit fails (R3)', async () => {
    await database.query(`CREATE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test-only audit failure'; END $$;
      CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.entity = 'task') EXECUTE FUNCTION fail_audit()`);
    const before = await snapshot();
    const upload = await submit({ ...submission, rosterAssignmentId: 'RA-1' }, 'w-1');
    expect(upload.status).toBe(500);
    expect(JSON.stringify(upload.body)).not.toContain('test-only');
    expect(await snapshot()).toBe(before);
    expect((await review('DOC-w-2-passport-1', { decision: 'reject', reason: 'Unreadable' })).status).toBe(500);
    expect(await snapshot()).toBe(before);
    await database.query('DROP TRIGGER fail_audit ON audit_log; DROP FUNCTION fail_audit()');
    expect((await submit({ ...submission, rosterAssignmentId: 'RA-1' }, 'w-1')).status).toBe(201);
  });

  it('serializes separate submissions and competing final QC decisions without duplicated effects (R2/R3/R7)', async () => {
    const [first, second] = await Promise.all([
      submit({ ...submission, clientSubmissionId: 'one' }), submit({ ...submission, clientSubmissionId: 'two' }),
    ]);
    expect([first, second].map((response) => response.status)).toEqual([201, 201]);
    expect([first, second].map((response) => response.body.version).sort()).toEqual([2, 3]);
    const results = await Promise.all([
      review(first.body.documentVersionId), review(first.body.documentVersionId, { decision: 'reject', reason: 'Unreadable' }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await database.query('SELECT count(*)::int AS count FROM qc_reviews WHERE document_version_id=$1', [first.body.documentVersionId])).rows)
      .toEqual([{ count: 1 }]);
  });

  it('scopes keys by user and makes cross-order key races atomic (R5)', async () => {
    const firstUser = await submit();
    const secondUser = await submit({ ...submission, rosterAssignmentId: 'RA-2' }, 'w-2');
    expect([firstUser.status, secondUser.status]).toEqual([201, 201]);
    expect(firstUser.body.documentVersionId).not.toBe(secondUser.body.documentVersionId);
    await database.query(`
      INSERT INTO job_orders(id,branch_id) VALUES ('JO-SECOND','norte');
      INSERT INTO required_document_types(job_order_id,document_type) VALUES ('JO-SECOND','passport');
      INSERT INTO roster_assignments(id,worker_id,job_order_id,owning_capturist_id)
      VALUES ('RA-SECOND','w-5','JO-SECOND','u-marta')`);
    const original = { ...submission, clientSubmissionId: 'cross-order' };
    const other = { ...original, rosterAssignmentId: 'RA-SECOND' };
    const [a, b] = await Promise.all([submit(original), submit(other)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const beforeReplay = await snapshot();
    const winner = a.status === 201 ? a : b;
    const replay = await submit(a.status === 201 ? original : other);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(winner.body);
    expect((await submit(a.status === 201 ? other : original)).status).toBe(409);
    expect(await snapshot()).toBe(beforeReplay);
    expect((await database.query("SELECT count(*)::int AS count FROM submission_receipts WHERE client_submission_id='cross-order'")).rows)
      .toEqual([{ count: 1 }]);
  });

  it('uses the highest approved submission version, not the most recently reviewed or uploaded version (R6)', async () => {
    const body = { ...submission, rosterAssignmentId: 'RA-1', fields: { documentNumber: 'second' } };
    const second = await submit(body, 'w-1');
    const third = await submit({ ...body, clientSubmissionId: 'third', fields: { documentNumber: 'third' } }, 'w-1');
    expect([second.status, third.status]).toEqual([201, 201]);
    expect((await review(third.body.documentVersionId)).status).toBe(200);
    expect((await review(second.body.documentVersionId)).status).toBe(200);
    const matching = await submit({ ...body, clientSubmissionId: 'matching', fields: { documentNumber: 'third' } }, 'w-1');
    expect(matching.status).toBe(201);
    expect(matching.body.conflict).toBe(false);
    const older = await submit({ ...body, clientSubmissionId: 'older' }, 'w-1');
    expect(older.status).toBe(201);
    expect(older.body.conflict).toBe(true);
  });

});
