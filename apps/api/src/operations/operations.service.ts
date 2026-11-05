import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AcceptanceRequest, AcceptanceResponse, AssignmentReadiness, EmployerDecisionRequest, EmployerDecisionResponse, ReadinessGate, ReadinessResponse, ScheduleRequest, ScheduleResult, ScheduleResponse } from '@creme/contracts';
import { DatabaseService } from '../database.service.js';
import {
  acceptances, appointmentMemberships, appointments, documentVersions, employerDecisions,
  jobOrders, qcReviews, requiredDocumentTypes, rosterAssignments, termsVersions, workers,
} from '../database/schema.js';
import { assignment, audit, caller, lockOrder } from '../documents/transaction.js';
import type { Transaction } from '../documents/transaction.js';

const passed = (reason: string): ReadinessGate => ({ passed: true, reason });
const failed = (reason: string): ReadinessGate => ({ passed: false, reason });
type AssignmentRow = { assignment: typeof rosterAssignments.$inferSelect; workerId: string; workerUserId: string; workerName: string };
@Injectable()
export class OperationsService {
  constructor(private readonly database: DatabaseService) {}

  employerDecision(userId: string | undefined, assignmentId: string, input: EmployerDecisionRequest): Promise<EmployerDecisionResponse> {
    return this.database.db.transaction(async (tx) => {
      const actor = await caller(tx, userId, 'labor_coordinator');
      const initial = await assignment(tx, assignmentId);
      const order = await lockOrder(tx, initial.assignment.jobOrderId);
      await assignment(tx, assignmentId);
      if (order.branchId !== actor.branchId) throw new NotFoundException('Record not found');
      const [current] = await tx.select().from(employerDecisions).where(and(
        eq(employerDecisions.rosterAssignmentId, assignmentId), isNull(employerDecisions.supersededAt),
      ));
      const response = { rosterAssignmentId: assignmentId, decision: 'approved' as const, ...input };
      if (current && current.decision === 'approved' && current.evidence === input.evidence && current.decidedOn === input.decidedOn) return response;
      if (current) {
        const supersededAt = new Date();
        await tx.update(employerDecisions).set({ supersededAt }).where(eq(employerDecisions.id, current.id));
        await audit(tx, actor, { entity: 'employer_decision', entityId: current.id, field: 'superseded', oldValue: current, newValue: { ...current, supersededAt } });
      }
      const [created] = await tx.insert(employerDecisions).values({ rosterAssignmentId: assignmentId, decision: 'approved', ...input, actorId: actor.id }).returning();
      if (!created) throw new Error('Employer decision insert returned no row');
      await audit(tx, actor, { entity: 'employer_decision', entityId: created.id, field: 'created', oldValue: null, newValue: created });
      return response;
    }, { isolationLevel: 'read committed' });
  }

  acceptance(userId: string | undefined, assignmentId: string, input: AcceptanceRequest): Promise<AcceptanceResponse> {
    return this.database.db.transaction(async (tx) => {
      if (!userId) throw new ForbiddenException('Caller and required role are required');
      const actor = await this.coordinatorOrWorker(tx, userId);
      if (actor.role === 'worker' && input.method !== 'in_app') throw new ForbiddenException('Worker acceptance must be recorded in_app');
      const initial = await assignment(tx, assignmentId);
      if (actor.role === 'worker' && initial.workerUserId !== actor.id) throw new NotFoundException('Record not found');
      const order = await lockOrder(tx, initial.assignment.jobOrderId);
      const record = await assignment(tx, assignmentId);
      if (actor.role === 'worker' && record.workerUserId !== actor.id) throw new NotFoundException('Record not found');
      if (actor.role === 'labor_coordinator' && order.branchId !== actor.branchId) throw new NotFoundException('Record not found');
      if (actor.role === 'labor_coordinator' && input.method !== 'verbal') throw new ForbiddenException('Coordinator acceptance must be recorded as verbal');
      const [terms] = await tx.select().from(termsVersions).where(and(eq(termsVersions.id, input.termsVersionId), eq(termsVersions.jobOrderId, order.id)));
      if (!terms) throw new NotFoundException('Record not found');
      const [existing] = await tx.select().from(acceptances).where(and(
        eq(acceptances.rosterAssignmentId, assignmentId), eq(acceptances.termsVersionId, input.termsVersionId),
      ));
      const response = { rosterAssignmentId: assignmentId, termsVersionId: input.termsVersionId, method: existing?.method ?? input.method };
      if (existing) return response;
      const [created] = await tx.insert(acceptances).values({
        rosterAssignmentId: assignmentId, jobOrderId: order.id, termsVersionId: input.termsVersionId,
        actorId: actor.id, method: input.method,
      }).returning();
      if (!created) throw new Error('Acceptance insert returned no row');
      await audit(tx, actor, { entity: 'acceptance', entityId: created.id, field: 'created', oldValue: null, newValue: created }, actor.role === 'labor_coordinator' ? record.workerUserId : null);
      return response;
    }, { isolationLevel: 'read committed' });
  }

  async readiness(userId: string | undefined, orderId: string): Promise<ReadinessResponse> {
    return this.database.db.transaction(async (tx) => {
      const actor = await caller(tx, userId, 'labor_coordinator');
      const order = await lockOrder(tx, orderId);
      if (order.branchId !== actor.branchId) throw new NotFoundException('Record not found');
      return this.readinessForOrder(tx, order.id);
    }, { isolationLevel: 'read committed' });
  }

  schedule(userId: string | undefined, appointmentId: string, input: ScheduleRequest): Promise<ScheduleResponse> {
    return this.database.db.transaction(async (tx) => {
      const actor = await caller(tx, userId, 'labor_coordinator');
      const [initial] = await tx.select().from(appointments).where(eq(appointments.id, appointmentId));
      if (!initial || initial.status !== 'active') throw new NotFoundException('Record not found');
      const order = await lockOrder(tx, initial.jobOrderId);
      const [appointment] = await tx.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.status, 'active'))).for('update');
      if (!appointment) throw new NotFoundException('Record not found');
      if (order.branchId !== actor.branchId) throw new NotFoundException('Record not found');

      const assignments: AssignmentRow[] = await tx.select({ assignment: rosterAssignments, workerId: workers.id, workerUserId: workers.userId, workerName: workers.name })
        .from(rosterAssignments).innerJoin(workers, eq(workers.id, rosterAssignments.workerId))
        .where(and(eq(rosterAssignments.jobOrderId, order.id), eq(rosterAssignments.status, 'active'), isNull(workers.archivedAt)));
      const readiness = await this.readinessForOrder(tx, order.id);
      const assignmentById = new Map(assignments.map((row) => [row.assignment.id, row]));
      const readinessById = new Map(readiness.assignments.map((row) => [row.rosterAssignmentId, row]));
      const scheduled = await tx.select({ rosterAssignmentId: appointmentMemberships.rosterAssignmentId, appointmentId: appointmentMemberships.appointmentId })
        .from(appointmentMemberships).where(and(eq(appointmentMemberships.jobOrderId, order.id), eq(appointmentMemberships.status, 'scheduled')));
      const scheduledByAssignment = new Map(scheduled.map((row) => [row.rosterAssignmentId, row.appointmentId]));
      const [countRow] = await tx.select({ count: sql<number>`count(*)::int` }).from(appointmentMemberships)
        .where(and(eq(appointmentMemberships.appointmentId, appointment.id), eq(appointmentMemberships.status, 'scheduled')));
      let remainingCapacity = appointment.capacity - (countRow?.count ?? 0);
      const results: ScheduleResult[] = [];
      for (const id of input.rosterAssignmentIds) {
        const record = assignmentById.get(id);
        if (!record) {
          results.push({ rosterAssignmentId: id, status: 'refused' as const, reasons: ['Assignment is not available for this job order.'] });
          continue;
        }
        const existingAppointmentId = scheduledByAssignment.get(id);
        if (existingAppointmentId === appointment.id) {
          results.push({ rosterAssignmentId: id, status: 'already_scheduled' as const });
          continue;
        }
        if (existingAppointmentId) {
          results.push({ rosterAssignmentId: id, status: 'refused' as const, reasons: ['Assignment is already scheduled in another appointment.'] });
          continue;
        }
        const current = readinessById.get(id);
        if (!current?.ready) {
          results.push({ rosterAssignmentId: id, status: 'refused' as const, reasons: current ? Object.values(current.gates).filter((gate) => !gate.passed).map((gate) => gate.reason) : ['Assignment is not available for this job order.'] });
          continue;
        }
        if (remainingCapacity <= 0) {
          results.push({ rosterAssignmentId: id, status: 'refused' as const, reasons: ['Appointment has no remaining capacity.'] });
          continue;
        }
        const [membership] = await tx.insert(appointmentMemberships).values({
          appointmentId: appointment.id, rosterAssignmentId: id, jobOrderId: order.id, actorId: actor.id,
        }).returning();
        if (!membership) throw new Error('Appointment membership insert returned no row');
        await audit(tx, actor, { entity: 'appointment_membership', entityId: membership.id, field: 'created', oldValue: null, newValue: membership });
        scheduledByAssignment.set(id, appointment.id);
        remainingCapacity -= 1;
        results.push({ rosterAssignmentId: id, status: 'scheduled' as const });
      }
      return { appointmentId: appointment.id, remainingCapacity, results };
    }, { isolationLevel: 'read committed' });
  }

  private async coordinatorOrWorker(tx: Transaction, userId: string) {
    for (const role of ['labor_coordinator', 'worker'] as const) {
      try {
        const user = await caller(tx, userId, role);
        return { ...user, role };
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    throw new ForbiddenException('Caller and required role are required');
  }

  private async readinessForOrder(tx: Transaction, orderId: string): Promise<ReadinessResponse> {
    const [order] = await tx.select().from(jobOrders).where(and(eq(jobOrders.id, orderId), eq(jobOrders.status, 'active')));
    if (!order) throw new NotFoundException('Record not found');
    const assignments: AssignmentRow[] = await tx.select({ assignment: rosterAssignments, workerId: workers.id, workerUserId: workers.userId, workerName: workers.name })
      .from(rosterAssignments).innerJoin(workers, eq(workers.id, rosterAssignments.workerId))
      .where(and(eq(rosterAssignments.jobOrderId, orderId), eq(rosterAssignments.status, 'active'), isNull(workers.archivedAt)));
    const [currentTerms] = await tx.select().from(termsVersions).where(and(eq(termsVersions.jobOrderId, orderId), eq(termsVersions.status, 'current')));
    const required = await tx.select().from(requiredDocumentTypes).where(eq(requiredDocumentTypes.jobOrderId, orderId));
    const ids = assignments.map((row) => row.assignment.id);
    const employers = ids.length ? await tx.select().from(employerDecisions)
      .where(and(inArray(employerDecisions.rosterAssignmentId, ids), isNull(employerDecisions.supersededAt))) : [];
    const currentAcceptances = currentTerms && ids.length ? await tx.select().from(acceptances)
      .where(and(inArray(acceptances.rosterAssignmentId, ids), eq(acceptances.termsVersionId, currentTerms.id))) : [];
    const documents = ids.length ? await tx.select({ document: documentVersions, decision: qcReviews.decision }).from(documentVersions)
      .leftJoin(qcReviews, eq(qcReviews.documentVersionId, documentVersions.id))
      .where(and(inArray(documentVersions.rosterAssignmentId, ids), eq(documentVersions.jobOrderId, orderId)))
      .orderBy(desc(documentVersions.version)) : [];
    const bookings = ids.length ? await tx.select().from(appointmentMemberships)
      .where(and(inArray(appointmentMemberships.rosterAssignmentId, ids), eq(appointmentMemberships.status, 'scheduled'))) : [];
    const apptRows = await tx.select().from(appointments)
      .where(and(eq(appointments.jobOrderId, orderId), eq(appointments.status, 'active'))).orderBy(appointments.startsAt);
    const employerByAssignment = new Set(employers.filter((row) => row.decision === 'approved').map((row) => row.rosterAssignmentId));
    const acceptanceByAssignment = new Set(currentAcceptances.map((row) => row.rosterAssignmentId));
    const versionsByAssignment = new Map<string, typeof documents>();
    for (const row of documents) {
      const list = versionsByAssignment.get(row.document.rosterAssignmentId) ?? [];
      list.push(row);
      versionsByAssignment.set(row.document.rosterAssignmentId, list);
    }
    const bookingByAssignment = new Map(bookings.map((row) => [row.rosterAssignmentId, row.appointmentId]));
    const readinessRows: AssignmentReadiness[] = assignments.map((row) => {
      const applicable = versionsByAssignment.get(row.assignment.id) ?? [];
      const activeByType = new Map<string, (typeof applicable)[number]>();
      const approvedByType = new Map<string, (typeof applicable)[number]>();
      for (const version of applicable) {
        const type = version.document.documentType;
        if (!activeByType.has(type)) activeByType.set(type, version);
        if (version.decision === 'approve' && !approvedByType.has(type)) approvedByType.set(type, version);
      }
      const missing = required.filter((doc) => !activeByType.has(doc.documentType)).map((doc) => doc.documentType);
      const documentsGate = missing.length ? failed(`Missing required documents: ${missing.join(', ')}.`) : passed('All required documents are present.');
      const qcReasons = required.filter((doc) => {
        const active = approvedByType.get(doc.documentType) ?? activeByType.get(doc.documentType);
        return !active || active.decision !== 'approve';
      }).map((doc) => activeByType.has(doc.documentType) ? `${doc.documentType} is not approved.` : `${doc.documentType} has no active version.`);
      const qcGate = qcReasons.length ? failed(qcReasons.join(' ')) : passed('All active documents are approved.');
      const employerApproval = employerByAssignment.has(row.assignment.id) ? passed('Employer approval recorded.') : failed('Employer approval is missing.');
      const acceptance = currentTerms && acceptanceByAssignment.has(row.assignment.id) ? passed('Current terms accepted.') : failed(currentTerms ? 'Current terms have not been accepted.' : 'No current terms version is available.');
      const gates = { employerApproval, acceptance, documents: documentsGate, qc: qcGate };
      return { rosterAssignmentId: row.assignment.id, workerId: row.workerId, workerName: row.workerName, ready: Object.values(gates).every((gate) => gate.passed), gates, scheduledAppointmentId: bookingByAssignment.get(row.assignment.id) ?? null };
    });
    const counts = apptRows.length ? await tx.select({ appointmentId: appointmentMemberships.appointmentId, count: sql<number>`count(*)::int` })
      .from(appointmentMemberships).where(and(inArray(appointmentMemberships.appointmentId, apptRows.map((row) => row.id)), eq(appointmentMemberships.status, 'scheduled')))
      .groupBy(appointmentMemberships.appointmentId) : [];
    const countByAppointment = new Map(counts.map((row) => [row.appointmentId, row.count]));
    const capacityRows = apptRows.map((appointment) => ({ id: appointment.id, startsAt: appointment.startsAt.toISOString(), capacity: appointment.capacity, remainingCapacity: appointment.capacity - (countByAppointment.get(appointment.id) ?? 0) }));
    return { jobOrderId: orderId, currentTermsVersionId: currentTerms?.id ?? null, assignments: readinessRows, appointments: capacityRows };
  }
}
