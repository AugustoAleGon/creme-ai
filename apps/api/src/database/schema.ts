import { sql } from 'drizzle-orm';
import {
  check, date, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey,
  text, timestamp, unique, uniqueIndex,
} from 'drizzle-orm/pg-core';

const id = () => text('id').primaryKey().default(sql`gen_random_uuid()::text`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const role = pgEnum('role', ['capturist', 'qc_reviewer', 'labor_coordinator', 'worker']);
export const recordStatus = pgEnum('record_status', ['active', 'archived', 'cancelled']);
export const termsStatus = pgEnum('terms_status', ['current', 'superseded']);
export const documentType = pgEnum('document_type', ['passport', 'ds160_confirmation', 'signed_contract']);
export const reviewDecision = pgEnum('review_decision', ['approve', 'reject']);
export const employerDecision = pgEnum('employer_decision', ['approved', 'rejected']);
export const evidence = pgEnum('evidence', ['document', 'verbal']);
export const acceptanceMethod = pgEnum('acceptance_method', ['verbal', 'in_app']);
export const taskStatus = pgEnum('task_status', ['open', 'resolved', 'cancelled']);
export const bookingStatus = pgEnum('booking_status', ['scheduled', 'cancelled']);

export const branches = pgTable('branches', {
  id: id(), name: text('name').notNull().unique(), createdAt: createdAt(),
});

export const users = pgTable('users', {
  id: id(), name: text('name').notNull(),
  branchId: text('branch_id').references(() => branches.id),
  status: recordStatus('status').notNull().default('active'), createdAt: createdAt(),
});

export const userRoles = pgTable('user_roles', {
  userId: text('user_id').notNull().references(() => users.id), role: role('role').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.role] })]);

// R1: this ID is the case system's canonical external ID, never a copied internal ID.
export const jobOrders = pgTable('job_orders', {
  id: text('id').primaryKey(), branchId: text('branch_id').notNull().references(() => branches.id),
  status: recordStatus('status').notNull().default('active'), createdAt: createdAt(),
});

export const termsVersions = pgTable('terms_versions', {
  id: id(), jobOrderId: text('job_order_id').notNull().references(() => jobOrders.id),
  version: integer('version').notNull(), status: termsStatus('status').notNull(),
  content: text('content').notNull(), createdAt: createdAt(),
}, (t) => [
  unique('terms_order_version_unique').on(t.jobOrderId, t.version),
  unique('terms_id_order_unique').on(t.id, t.jobOrderId),
  uniqueIndex('terms_one_current_per_order').on(t.jobOrderId).where(sql`${t.status} = 'current'`),
  check('terms_positive_version', sql`${t.version} > 0`),
]);

// R1: identity survives any assignment, season or job order.
export const workers = pgTable('workers', {
  id: id(), userId: text('user_id').notNull().unique().references(() => users.id),
  name: text('name').notNull(), archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const rosterAssignments = pgTable('roster_assignments', {
  id: id(), workerId: text('worker_id').notNull().references(() => workers.id),
  jobOrderId: text('job_order_id').notNull().references(() => jobOrders.id),
  owningCapturistId: text('owning_capturist_id').notNull().references(() => users.id),
  status: recordStatus('status').notNull().default('active'), createdAt: createdAt(),
}, (t) => [
  unique('assignment_worker_order_unique').on(t.workerId, t.jobOrderId),
  unique('assignment_id_order_unique').on(t.id, t.jobOrderId),
  index('assignments_order_idx').on(t.jobOrderId),
]);

export const employerDecisions = pgTable('employer_decisions', {
  id: id(), rosterAssignmentId: text('roster_assignment_id').notNull().references(() => rosterAssignments.id),
  decision: employerDecision('decision').notNull(), evidence: evidence('evidence').notNull(),
  decidedOn: date('decided_on').notNull(), actorId: text('actor_id').notNull().references(() => users.id),
  supersededAt: timestamp('superseded_at', { withTimezone: true }), createdAt: createdAt(),
}, (t) => [uniqueIndex('employer_one_current_decision').on(t.rosterAssignmentId).where(sql`${t.supersededAt} IS NULL`)]);

export const acceptances = pgTable('acceptances', {
  id: id(), rosterAssignmentId: text('roster_assignment_id').notNull(),
  jobOrderId: text('job_order_id').notNull(), termsVersionId: text('terms_version_id').notNull(),
  actorId: text('actor_id').notNull().references(() => users.id),
  method: acceptanceMethod('method').notNull(), createdAt: createdAt(),
}, (t) => [
  unique('acceptance_assignment_terms_unique').on(t.rosterAssignmentId, t.termsVersionId),
  foreignKey({ columns: [t.rosterAssignmentId, t.jobOrderId], foreignColumns: [rosterAssignments.id, rosterAssignments.jobOrderId] }),
  foreignKey({ columns: [t.termsVersionId, t.jobOrderId], foreignColumns: [termsVersions.id, termsVersions.jobOrderId] }),
]);

export const requiredDocumentTypes = pgTable('required_document_types', {
  jobOrderId: text('job_order_id').notNull().references(() => jobOrders.id),
  documentType: documentType('document_type').notNull(),
}, (t) => [primaryKey({ columns: [t.jobOrderId, t.documentType] })]);

// R2/R6/R7: payload and QC are separate. No review means pending_review; never mutate a version to resubmit.
export const documentVersions = pgTable('document_versions', {
  id: id(), rosterAssignmentId: text('roster_assignment_id').notNull(),
  jobOrderId: text('job_order_id').notNull(), documentType: documentType('document_type').notNull(),
  version: integer('version').notNull(), fields: jsonb('fields').notNull(), fileRef: text('file_ref').notNull(),
  submittedBy: text('submitted_by').notNull().references(() => users.id),
  capturedBy: text('captured_by').references(() => users.id), createdAt: createdAt(),
}, (t) => [
  unique('document_assignment_type_version_unique').on(t.rosterAssignmentId, t.documentType, t.version),
  unique('document_id_assignment_type_unique').on(t.id, t.rosterAssignmentId, t.documentType),
  foreignKey({ columns: [t.rosterAssignmentId, t.jobOrderId], foreignColumns: [rosterAssignments.id, rosterAssignments.jobOrderId] }),
  foreignKey({ columns: [t.jobOrderId, t.documentType], foreignColumns: [requiredDocumentTypes.jobOrderId, requiredDocumentTypes.documentType] }),
  check('document_positive_version', sql`${t.version} > 0`),
  check('document_fields_object', sql`jsonb_typeof(${t.fields}) = 'object'`),
  check('document_file_ref_nonempty', sql`length(trim(${t.fileRef})) > 0`),
]);

export const qcReviews = pgTable('qc_reviews', {
  id: id(), documentVersionId: text('document_version_id').notNull().unique().references(() => documentVersions.id),
  reviewerId: text('reviewer_id').notNull().references(() => users.id),
  decision: reviewDecision('decision').notNull(), reason: text('reason'), createdAt: createdAt(),
}, (t) => [check('review_rejection_reason', sql`${t.decision} <> 'reject' OR nullif(trim(${t.reason}), '') IS NOT NULL`)]);

export const tasks = pgTable('tasks', {
  id: id(), rosterAssignmentId: text('roster_assignment_id').notNull().references(() => rosterAssignments.id),
  documentType: documentType('document_type').notNull(), sourceVersionId: text('source_version_id').notNull(),
  ownerId: text('owner_id').notNull().references(() => users.id),
  reason: text('reason').notNull(), status: taskStatus('status').notNull().default('open'),
  createdAt: createdAt(), resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => [
  // One open correction per assignment/type; resolving it preserves history.
  uniqueIndex('task_one_open_correction').on(t.rosterAssignmentId, t.documentType).where(sql`${t.status} = 'open'`),
  foreignKey({ columns: [t.sourceVersionId, t.rosterAssignmentId, t.documentType], foreignColumns: [documentVersions.id, documentVersions.rosterAssignmentId, documentVersions.documentType] }),
  index('tasks_owner_status_idx').on(t.ownerId, t.status),
]);

export const appointments = pgTable('appointments', {
  id: id(), jobOrderId: text('job_order_id').notNull().references(() => jobOrders.id),
  capacity: integer('capacity').notNull(), startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  status: recordStatus('status').notNull().default('active'), createdAt: createdAt(),
}, (t) => [
  unique('appointment_id_order_unique').on(t.id, t.jobOrderId),
  check('appointment_positive_capacity', sql`${t.capacity} > 0`),
]);

export const appointmentMemberships = pgTable('appointment_memberships', {
  id: id(), appointmentId: text('appointment_id').notNull(), rosterAssignmentId: text('roster_assignment_id').notNull(),
  jobOrderId: text('job_order_id').notNull(), status: bookingStatus('status').notNull().default('scheduled'),
  actorId: text('actor_id').notNull().references(() => users.id), createdAt: createdAt(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
}, (t) => [
  // R10: assignment-scoped, not worker-lifetime-scoped. Capacity needs the later booking transaction.
  uniqueIndex('membership_one_active_assignment').on(t.rosterAssignmentId).where(sql`${t.status} = 'scheduled'`),
  foreignKey({ columns: [t.appointmentId, t.jobOrderId], foreignColumns: [appointments.id, appointments.jobOrderId] }),
  foreignKey({ columns: [t.rosterAssignmentId, t.jobOrderId], foreignColumns: [rosterAssignments.id, rosterAssignments.jobOrderId] }),
  index('memberships_appointment_status_idx').on(t.appointmentId, t.status),
]);

export const auditLog = pgTable('audit_log', {
  id: id(), actorId: text('actor_id').notNull().references(() => users.id),
  onBehalfOfUserId: text('on_behalf_of_user_id').references(() => users.id),
  entity: text('entity').notNull(), entityId: text('entity_id').notNull(), field: text('field').notNull(),
  oldValue: jsonb('old_value'), newValue: jsonb('new_value'), createdAt: createdAt(),
}, (t) => [index('audit_entity_history_idx').on(t.entity, t.entityId, t.createdAt)]);

// R5: a transaction claims the key first, then fills response/version before commit.
export const submissionReceipts = pgTable('submission_receipts', {
  userId: text('user_id').notNull().references(() => users.id),
  clientSubmissionId: text('client_submission_id').notNull(), request: jsonb('request').notNull(),
  response: jsonb('response'), documentVersionId: text('document_version_id').references(() => documentVersions.id),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.clientSubmissionId] }),
  check('submission_key_nonempty', sql`length(trim(${t.clientSubmissionId})) > 0`),
  check('submission_request_object', sql`jsonb_typeof(${t.request}) = 'object'`),
]);
