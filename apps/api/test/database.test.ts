import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

// This public seam is the database CLI plus SQL constraints, not application internals.
describe('database foundation CLI', () => {
  let admin: Pool;
  let database: Pool;
  let databaseUrl: string;
  let databaseName: string;
  let created = false;

  beforeEach(async () => {
    databaseName = `creme_${randomUUID().replaceAll('-', '')}_test`;
    created = false;
    const configured = process.env.TEST_DATABASE_URL;
    if (!configured || !new URL(configured).pathname.endsWith('_test')) {
      throw new Error('TEST_DATABASE_URL must point to a dedicated *_test database.');
    }
    const url = new URL(configured);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('Database foundation tests require local PostgreSQL.');
    }
    admin = new Pool({ connectionString: configured, max: 1 });
    // Only this random, test-owned database is created/dropped. Shared data stays intact.
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();
    database = new Pool({ connectionString: databaseUrl, max: 1 });
  });

  afterEach(async () => {
    await database?.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin?.end();
  });

  function command(...args: string[]) {
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(process.execPath, [fileURLToPath(new URL('../src/database/cli.js', import.meta.url)), ...args], {
        env: { ...process.env, DATABASE_URL: databaseUrl }, timeout: 15000,
      }, (error, stdout, stderr) => {
        resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr });
      });
    });
  }

  async function snapshot() {
    const tables = await database.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    const data: unknown[] = [];
    for (const { table_name } of tables.rows) {
      const quoted = `"${table_name.replaceAll('"', '""')}"`;
      const result = await database.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]') AS rows FROM ${quoted} t`);
      data.push({ table: table_name, rows: result.rows });
    }
    return JSON.stringify(data);
  }

  it('applies versioned migrations on an empty database and safely replays them (S3)', async () => {
    expect(await command('migrate')).toEqual({ code: 0, stdout: 'Database migrations applied.\n', stderr: '' });
    const { rows } = await database.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      'acceptances', 'appointment_memberships', 'appointments', 'audit_log', 'branches',
      'document_versions', 'employer_decisions', 'job_orders', 'qc_reviews',
      'required_document_types', 'roster_assignments', 'submission_receipts', 'tasks',
      'terms_versions', 'user_roles', 'users', 'workers',
    ]);
    await database.query("INSERT INTO branches (id, name) VALUES ('migration-sentinel', 'Preserve me')");
    expect(await command('migrate')).toEqual({ code: 0, stdout: 'Database migrations applied.\n', stderr: '' });
    expect((await database.query("SELECT name FROM branches WHERE id = 'migration-sentinel'")).rows)
      .toEqual([{ name: 'Preserve me' }]);
    expect((await database.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows)
      .toEqual([{ count: 1 }]);
    // Test-only fixture cleanup, never exposed by the application CLI.
    await database.query("DELETE FROM branches WHERE id = 'migration-sentinel'");
  });

  it('seeds exactly the required starting scenarios, including Bruno and Elena (S4)', async () => {
    expect(await command('seed')).toEqual({ code: 0, stdout: 'Seed data created.\n', stderr: '' });
    expect((await database.query('SELECT id, name FROM branches ORDER BY id')).rows).toEqual([
      { id: 'norte', name: 'Norte' }, { id: 'sur', name: 'Sur' },
    ]);
    expect((await database.query('SELECT id, branch_id FROM job_orders')).rows)
      .toEqual([{ id: 'JO-2026-0142', branch_id: 'norte' }]);
    expect((await database.query('SELECT version, status FROM terms_versions ORDER BY version')).rows)
      .toEqual([{ version: 1, status: 'superseded' }, { version: 2, status: 'current' }]);
    expect((await database.query('SELECT document_type FROM required_document_types ORDER BY document_type::text')).rows)
      .toEqual([{ document_type: 'ds160_confirmation' }, { document_type: 'passport' }, { document_type: 'signed_contract' }]);
    expect((await database.query(`
      SELECT u.id, u.branch_id, array_agg(r.role::text ORDER BY r.role::text) AS roles
      FROM users u JOIN user_roles r ON r.user_id = u.id
      WHERE u.id LIKE 'u-%' GROUP BY u.id ORDER BY u.id
    `)).rows).toEqual([
      { id: 'u-luis', branch_id: 'norte', roles: ['qc_reviewer'] },
      { id: 'u-marta', branch_id: 'norte', roles: ['capturist'] },
      { id: 'u-pedro', branch_id: 'norte', roles: ['labor_coordinator'] },
      { id: 'u-rosa', branch_id: 'norte', roles: ['capturist', 'qc_reviewer'] },
      { id: 'u-sofia', branch_id: 'sur', roles: ['labor_coordinator'] },
    ]);
    expect((await database.query(`
      SELECT w.id, w.name, a.owning_capturist_id AS owner,
        e.decision AS employer, t.version AS accepted_terms,
        count(d.id)::int AS documents,
        count(q.id) FILTER (WHERE q.decision = 'approve')::int AS approved
      FROM workers w JOIN roster_assignments a ON a.worker_id = w.id
      LEFT JOIN employer_decisions e ON e.roster_assignment_id = a.id
      JOIN acceptances ac ON ac.roster_assignment_id = a.id
      JOIN terms_versions t ON t.id = ac.terms_version_id
      JOIN document_versions d ON d.roster_assignment_id = a.id
      LEFT JOIN qc_reviews q ON q.document_version_id = d.id
      GROUP BY w.id, a.owning_capturist_id, e.decision, t.version ORDER BY w.id
    `)).rows).toEqual([
      { id: 'w-1', name: 'Ana López', owner: 'u-marta', employer: 'approved', accepted_terms: 2, documents: 3, approved: 3 },
      { id: 'w-2', name: 'Bruno Díaz', owner: 'u-marta', employer: 'approved', accepted_terms: 2, documents: 3, approved: 2 },
      { id: 'w-3', name: 'Carla Ruiz', owner: 'u-marta', employer: 'approved', accepted_terms: 1, documents: 3, approved: 3 },
      { id: 'w-4', name: 'Diego Mora', owner: 'u-marta', employer: null, accepted_terms: 2, documents: 3, approved: 3 },
      { id: 'w-5', name: 'Elena Soto', owner: 'u-marta', employer: 'approved', accepted_terms: 2, documents: 3, approved: 2 },
      { id: 'w-6', name: 'Fausto Vega', owner: 'u-marta', employer: 'approved', accepted_terms: 2, documents: 3, approved: 3 },
    ]);
    expect((await database.query(`
      SELECT d.captured_by, q.decision, q.reviewer_id
      FROM document_versions d LEFT JOIN qc_reviews q ON q.document_version_id = d.id
      WHERE d.roster_assignment_id = 'RA-2' AND d.document_type = 'passport'
    `)).rows).toEqual([{ captured_by: 'u-rosa', decision: null, reviewer_id: null }]);
    expect((await database.query(`
      SELECT q.decision, q.reviewer_id, t.owner_id, t.status
      FROM document_versions d JOIN qc_reviews q ON q.document_version_id = d.id
      JOIN tasks t ON t.source_version_id = d.id
      WHERE d.roster_assignment_id = 'RA-5' AND d.document_type = 'passport'
    `)).rows).toEqual([{ decision: 'reject', reviewer_id: 'u-luis', owner_id: 'u-marta', status: 'open' }]);
    expect((await database.query('SELECT id, capacity FROM appointments ORDER BY id')).rows)
      .toEqual([{ id: 'APT-1', capacity: 2 }, { id: 'APT-2', capacity: 1 }]);
    expect((await database.query('SELECT count(*)::int AS count FROM appointment_memberships')).rows)
      .toEqual([{ count: 0 }]);
    expect((await database.query('SELECT count(*)::int AS count FROM users')).rows).toEqual([{ count: 11 }]);
    expect((await database.query("SELECT count(*)::int AS count FROM user_roles WHERE role = 'worker'")).rows)
      .toEqual([{ count: 6 }]);
    expect((await database.query('SELECT count(*)::int AS count FROM audit_log')).rows).toEqual([{ count: 93 }]);
    expect((await database.query('SELECT count(*)::int AS count FROM submission_receipts')).rows).toEqual([{ count: 0 }]);
  });

  it('preserves all rows and later user changes when seed or migration commands are replayed (R2/R3)', async () => {
    expect((await command('seed')).code).toBe(0);
    await database.query("UPDATE appointments SET capacity = 5 WHERE id = 'APT-1'");
    await database.query("UPDATE terms_versions SET status = 'superseded' WHERE id = 'TERMS-2'");
    await database.query("INSERT INTO terms_versions (id, job_order_id, version, status, content) VALUES ('TERMS-3', 'JO-2026-0142', 3, 'current', 'New terms')");
    await database.query("INSERT INTO appointment_memberships (id, appointment_id, roster_assignment_id, job_order_id, actor_id) VALUES ('BOOK-1', 'APT-1', 'RA-1', 'JO-2026-0142', 'u-pedro')");
    const before = await snapshot();
    expect(await command('seed')).toEqual({ code: 0, stdout: 'Seed already applied; existing data preserved.\n', stderr: '' });
    expect((await command('migrate')).code).toBe(0);
    expect(await snapshot()).toBe(before);
  });

  it('serializes two first-time seed commands without duplicate rows or audit effects', async () => {
    const results = await Promise.all([command('seed'), command('seed')]);
    expect(results.map((result) => result.code)).toEqual([0, 0]);
    expect(results.map((result) => result.stderr)).toEqual(['', '']);
    expect(results.map((result) => result.stdout).sort()).toEqual([
      'Seed already applied; existing data preserved.\n', 'Seed data created.\n',
    ]);
    expect((await database.query('SELECT count(*)::int AS count FROM audit_log')).rows).toEqual([{ count: 93 }]);
    expect((await database.query('SELECT count(*)::int AS count FROM workers')).rows).toEqual([{ count: 6 }]);
  });

  it('refuses an unrecognized nonempty database without changing its data', async () => {
    expect((await command('migrate')).code).toBe(0);
    await database.query("INSERT INTO branches (id, name) VALUES ('existing', 'Keep existing data')");
    const before = await snapshot();
    expect(await command('seed')).toEqual({
      code: 1, stdout: '',
      stderr: 'Seed refused: domain data exists without the seed marker. Use a new empty database; existing data was preserved.\n',
    });
    expect(await snapshot()).toBe(before);
  });

  it('rolls back the entire seed, including audit entries, on a late database error (R3)', async () => {
    expect((await command('migrate')).code).toBe(0);
    await database.query(`
      CREATE FUNCTION reject_seed_task() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'private-document-value'; END;
      $$;
      CREATE TRIGGER reject_seed_task BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION reject_seed_task();
    `);
    const before = await snapshot();
    const result = await command('seed');
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('private-document-value');
    expect(await snapshot()).toBe(before);
    await database.query('DROP TRIGGER reject_seed_task ON tasks; DROP FUNCTION reject_seed_task()');
    expect((await command('seed')).stdout).toBe('Seed data created.\n');
  });

  it('rejects unknown options before connecting or changing the schema', async () => {
    const before = await snapshot();
    const result = await command('seed', '--reset');
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Usage: database <migrate|seed>');
    expect(await snapshot()).toBe(before);
  });

  it('backs identity, histories, valid values and same-order relationships with SQL constraints (R1/R5/R7/R10)', async () => {
    expect((await command('seed')).code).toBe(0);
    await database.query(`
      INSERT INTO job_orders (id, branch_id) VALUES ('JO-OTHER', 'sur');
      INSERT INTO terms_versions (id, job_order_id, version, status, content) VALUES ('OTHER-TERMS', 'JO-OTHER', 1, 'current', 'Other order');
      INSERT INTO appointments (id, job_order_id, capacity, starts_at) VALUES ('OTHER-APT', 'JO-OTHER', 1, now());
      INSERT INTO appointment_memberships (id, appointment_id, roster_assignment_id, job_order_id, actor_id) VALUES ('BOOK-1', 'APT-1', 'RA-1', 'JO-2026-0142', 'u-pedro');
      INSERT INTO submission_receipts (user_id, client_submission_id, request) VALUES ('w-1', 'offline-key', '{}');
    `);
    const refused = [
      ["INSERT INTO users (id, name, branch_id) VALUES ('bad', 'Bad', 'missing')", '23503'],
      ["INSERT INTO user_roles (user_id, role) VALUES ('w-1', 'administrator')", '22P02'],
      ["INSERT INTO user_roles (user_id, role) VALUES ('w-1', 'worker')", '23505'],
      ["INSERT INTO workers (id, user_id, name) VALUES ('duplicate', 'w-1', 'Duplicate')", '23505'],
      ["INSERT INTO roster_assignments (worker_id, job_order_id, owning_capturist_id) VALUES ('w-1', 'JO-2026-0142', 'u-marta')", '23505'],
      ["UPDATE terms_versions SET version = 0 WHERE id = 'TERMS-1'", '23514'],
      ["UPDATE terms_versions SET version = 2 WHERE id = 'TERMS-1'", '23505'],
      ["UPDATE terms_versions SET status = 'current' WHERE id = 'TERMS-1'", '23505'],
      ["UPDATE acceptances SET terms_version_id = 'OTHER-TERMS' WHERE id = 'AC-w-1'", '23503'],
      ["UPDATE employer_decisions SET decision = 'unknown' WHERE id = 'ED-w-1'", '22P02'],
      ["UPDATE appointments SET capacity = 0 WHERE id = 'APT-1'", '23514'],
      ["UPDATE document_versions SET version = 0 WHERE id = 'DOC-w-1-passport-1'", '23514'],
      ["UPDATE document_versions SET fields = '[]' WHERE id = 'DOC-w-1-passport-1'", '23514'],
      ["UPDATE document_versions SET file_ref = ' ' WHERE id = 'DOC-w-1-passport-1'", '23514'],
      ["UPDATE document_versions SET job_order_id = 'JO-OTHER' WHERE id = 'DOC-w-1-passport-1'", '23503'],
      ["INSERT INTO document_versions (roster_assignment_id, job_order_id, document_type, version, fields, file_ref, submitted_by) VALUES ('RA-1', 'JO-2026-0142', 'passport', 1, '{}', 'fixture://duplicate', 'w-1')", '23505'],
      ["INSERT INTO qc_reviews (document_version_id, reviewer_id, decision) VALUES ('DOC-w-1-passport-1', 'u-rosa', 'approve')", '23505'],
      ["UPDATE qc_reviews SET reason = NULL WHERE id = 'QC-DOC-w-5-passport-1'", '23514'],
      ["INSERT INTO tasks (roster_assignment_id, document_type, source_version_id, owner_id, reason) VALUES ('RA-5', 'passport', 'DOC-w-5-passport-1', 'u-marta', 'Duplicate')", '23505'],
      ["UPDATE tasks SET source_version_id = 'DOC-w-1-passport-1' WHERE id = 'TASK-ELENA-PASSPORT'", '23503'],
      ["INSERT INTO appointment_memberships (appointment_id, roster_assignment_id, job_order_id, actor_id) VALUES ('APT-2', 'RA-1', 'JO-2026-0142', 'u-pedro')", '23505'],
      ["INSERT INTO appointment_memberships (appointment_id, roster_assignment_id, job_order_id, actor_id) VALUES ('OTHER-APT', 'RA-6', 'JO-2026-0142', 'u-pedro')", '23503'],
      ["INSERT INTO submission_receipts (user_id, client_submission_id, request) VALUES ('w-1', 'offline-key', '{}')", '23505'],
      ["INSERT INTO submission_receipts (user_id, client_submission_id, request) VALUES ('w-1', ' ', '{}')", '23514'],
      ["INSERT INTO submission_receipts (user_id, client_submission_id, request) VALUES ('w-1', 'another', '[]')", '23514'],
      ["DELETE FROM job_orders WHERE id = 'JO-2026-0142'", '23503'],
    ] satisfies [string, string][];
    const before = await snapshot();
    for (const [query, code] of refused) {
      await expect(database.query(query)).rejects.toMatchObject({ code });
      expect(await snapshot()).toBe(before);
    }
    // R1/R2: valid historical records are not blocked by lifetime/global uniqueness.
    await database.query("UPDATE appointment_memberships SET status = 'cancelled', cancelled_at = now() WHERE id = 'BOOK-1'");
    await database.query("INSERT INTO appointment_memberships (appointment_id, roster_assignment_id, job_order_id, actor_id) VALUES ('APT-2', 'RA-1', 'JO-2026-0142', 'u-pedro')");
    await database.query("INSERT INTO roster_assignments (worker_id, job_order_id, owning_capturist_id) VALUES ('w-1', 'JO-OTHER', 'u-marta')");
    await database.query("INSERT INTO submission_receipts (user_id, client_submission_id, request) VALUES ('w-2', 'offline-key', '{}')");
    expect((await database.query("SELECT count(*)::int AS count FROM appointment_memberships WHERE roster_assignment_id = 'RA-1'")).rows)
      .toEqual([{ count: 2 }]);
  });
});
