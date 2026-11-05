import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as s from './schema.js';

const seedMarker = 'seed:creme-take-home:v1';
const jobOrderId = 'JO-2026-0142';
const actorId = 'u-marta';

export class SeedRefusal extends Error {
  constructor() {
    super('Seed refused: domain data exists without the seed marker. Use a new empty database; existing data was preserved.');
  }
}

// Called only by the serialized database CLI. One transaction includes all fixtures and audits.
export async function seedDatabase(db: NodePgDatabase): Promise<'created' | 'already_applied'> {
  return db.transaction(async (tx) => {
    const marker = await tx.select().from(s.auditLog).where(eq(s.auditLog.id, seedMarker));
    if (marker.length) return 'already_applied';
    for (const table of [
      s.branches, s.users, s.userRoles, s.jobOrders, s.termsVersions, s.workers,
      s.rosterAssignments, s.employerDecisions, s.acceptances, s.requiredDocumentTypes,
      s.documentVersions, s.qcReviews, s.tasks, s.appointments, s.appointmentMemberships,
      s.auditLog, s.submissionReceipts,
    ]) {
      if ((await tx.select().from(table).limit(1)).length) throw new SeedRefusal();
    }

    // Fixture creation is explicit bootstrap history, not a claim that staff used future endpoints.
    async function record<T>(entity: string, rows: T[], identify: (row: T) => string) {
      if (!rows.length) return;
      await tx.insert(s.auditLog).values(rows.map((row) => ({
        actorId, entity, entityId: identify(row), field: 'seed', oldValue: null, newValue: row,
      })));
    }

    const branches = await tx.insert(s.branches).values([
      { id: 'norte', name: 'Norte' }, { id: 'sur', name: 'Sur' },
    ]).returning();
    const workerFixtures = [
      { id: 'w-1', name: 'Ana López', assignmentId: 'RA-1', acceptedVersion: 2, employer: true },
      { id: 'w-2', name: 'Bruno Díaz', assignmentId: 'RA-2', acceptedVersion: 2, employer: true },
      { id: 'w-3', name: 'Carla Ruiz', assignmentId: 'RA-3', acceptedVersion: 1, employer: true },
      { id: 'w-4', name: 'Diego Mora', assignmentId: 'RA-4', acceptedVersion: 2, employer: false },
      { id: 'w-5', name: 'Elena Soto', assignmentId: 'RA-5', acceptedVersion: 2, employer: true },
      { id: 'w-6', name: 'Fausto Vega', assignmentId: 'RA-6', acceptedVersion: 2, employer: true },
    ];
    const users = await tx.insert(s.users).values([
      { id: 'u-pedro', name: 'Pedro', branchId: 'norte' },
      { id: 'u-sofia', name: 'Sofía', branchId: 'sur' },
      { id: 'u-marta', name: 'Marta', branchId: 'norte' },
      { id: 'u-luis', name: 'Luis', branchId: 'norte' },
      { id: 'u-rosa', name: 'Rosa', branchId: 'norte' },
      ...workerFixtures.map((worker) => ({ id: worker.id, name: worker.name, branchId: null })),
    ]).returning();
    await record('branches', branches, (row) => row.id);
    await record('users', users, (row) => row.id);
    const workerRoles = workerFixtures.map((worker) => ({ userId: worker.id, role: 'worker' } satisfies typeof s.userRoles.$inferInsert));
    await record('user_roles', await tx.insert(s.userRoles).values([
      { userId: 'u-pedro', role: 'labor_coordinator' }, { userId: 'u-sofia', role: 'labor_coordinator' },
      { userId: 'u-marta', role: 'capturist' }, { userId: 'u-luis', role: 'qc_reviewer' },
      { userId: 'u-rosa', role: 'capturist' }, { userId: 'u-rosa', role: 'qc_reviewer' }, ...workerRoles,
    ]).returning(), (row) => `${row.userId}:${row.role}`);
    await record('job_orders', await tx.insert(s.jobOrders).values({ id: jobOrderId, branchId: 'norte' }).returning(), (row) => row.id);
    await record('terms_versions', await tx.insert(s.termsVersions).values([
      { id: 'TERMS-1', jobOrderId, version: 1, status: 'superseded', content: 'Seasonal worker terms v1 (fixture).' },
      { id: 'TERMS-2', jobOrderId, version: 2, status: 'current', content: 'Seasonal worker terms v2 (fixture).' },
    ]).returning(), (row) => row.id);
    await record('required_document_types', await tx.insert(s.requiredDocumentTypes).values(
      s.documentType.enumValues.map((documentType) => ({ jobOrderId, documentType })),
    ).returning(), (row) => `${row.jobOrderId}:${row.documentType}`);
    await record('workers', await tx.insert(s.workers).values(
      workerFixtures.map((worker) => ({ id: worker.id, userId: worker.id, name: worker.name })),
    ).returning(), (row) => row.id);
    await record('roster_assignments', await tx.insert(s.rosterAssignments).values(
      workerFixtures.map((worker) => ({ id: worker.assignmentId, workerId: worker.id, jobOrderId, owningCapturistId: actorId })),
    ).returning(), (row) => row.id);
    await record('employer_decisions', await tx.insert(s.employerDecisions).values(
      workerFixtures.filter((worker) => worker.employer).map((worker) => ({
        id: `ED-${worker.id}`, rosterAssignmentId: worker.assignmentId, decision: 'approved',
        evidence: 'document', decidedOn: '2026-11-01', actorId: 'u-pedro',
      } satisfies typeof s.employerDecisions.$inferInsert)),
    ).returning(), (row) => row.id);
    await record('acceptances', await tx.insert(s.acceptances).values(workerFixtures.map((worker) => ({
      id: `AC-${worker.id}`, rosterAssignmentId: worker.assignmentId, jobOrderId,
      termsVersionId: `TERMS-${worker.acceptedVersion}`, actorId: worker.id, method: 'in_app',
    } satisfies typeof s.acceptances.$inferInsert))).returning(), (row) => row.id);

    for (const worker of workerFixtures) {
      for (const documentType of s.documentType.enumValues) {
        const versionId = `DOC-${worker.id}-${documentType}-1`;
        const capturedBy = worker.id === 'w-2' && documentType === 'passport' ? 'u-rosa' : actorId;
        await record('document_versions', await tx.insert(s.documentVersions).values({
          id: versionId, rosterAssignmentId: worker.assignmentId, jobOrderId, documentType, version: 1,
          fields: { documentNumber: `${documentType}-${worker.id}`, expiresOn: '2030-01-01' },
          fileRef: `fixture://${versionId}`, submittedBy: capturedBy, capturedBy,
        }).returning(), (row) => row.id);
        // Brief scenario 2 needs Bruno's other two documents approved. His passport has no review.
        if (worker.id === 'w-2' && documentType === 'passport') continue;
        const rejected = worker.id === 'w-5' && documentType === 'passport';
        await record('qc_reviews', await tx.insert(s.qcReviews).values({
          id: `QC-${versionId}`, documentVersionId: versionId, reviewerId: 'u-luis',
          decision: rejected ? 'reject' : 'approve', reason: rejected ? 'Passport image is unreadable.' : null,
        }).returning(), (row) => row.id);
        if (rejected) {
          await record('tasks', await tx.insert(s.tasks).values({
            id: 'TASK-ELENA-PASSPORT', rosterAssignmentId: worker.assignmentId, documentType,
            sourceVersionId: versionId, ownerId: actorId, reason: 'Submit a readable passport image.',
          }).returning(), (row) => row.id);
        }
      }
    }
    await record('appointments', await tx.insert(s.appointments).values([
      { id: 'APT-1', jobOrderId, capacity: 2, startsAt: new Date('2026-11-20T15:00:00Z') },
      { id: 'APT-2', jobOrderId, capacity: 1, startsAt: new Date('2026-11-21T15:00:00Z') },
    ]).returning(), (row) => row.id);
    await tx.insert(s.auditLog).values({
      id: seedMarker, actorId, entity: 'seed', entityId: 'creme-take-home:v1',
      field: 'initialized', oldValue: null, newValue: { fixture: 'S4' },
    });
    return 'created';
  });
}
