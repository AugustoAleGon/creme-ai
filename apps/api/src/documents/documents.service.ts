import { ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { DatabaseService } from '../database.service.js';
import { documentVersions, qcReviews, requiredDocumentTypes, submissionReceipts } from '../database/schema.js';
import { openCorrection, resolveCorrections } from './corrections.js';
import { fields, type Review, type Submission } from './input.js';
import { assignment, audit, caller, lockOrder } from './transaction.js';

@Injectable()
export class DocumentsService {
  constructor(private readonly database: DatabaseService) {}

  submit(userId: string | undefined, input: Submission) {
    return this.database.db.transaction(async (tx) => {
      const actor = await caller(tx, userId, 'worker');
      const initial = await assignment(tx, input.rosterAssignmentId);
      if (initial.workerUserId !== actor.id) throw new NotFoundException('Record not found');
      await lockOrder(tx, initial.assignment.jobOrderId);
      const record = await assignment(tx, input.rosterAssignmentId);
      if (record.workerUserId !== actor.id) throw new NotFoundException('Record not found');
      const [required] = await tx.select().from(requiredDocumentTypes).where(and(
        eq(requiredDocumentTypes.jobOrderId, record.assignment.jobOrderId),
        eq(requiredDocumentTypes.documentType, input.documentType),
      ));
      if (!required) throw new NotFoundException('Record not found');
      // R5: authorization precedes replay; the unique key is shared across all orders.
      const key = and(eq(submissionReceipts.userId, actor.id), eq(submissionReceipts.clientSubmissionId, input.clientSubmissionId));
      const [claim] = await tx.insert(submissionReceipts).values({ userId: actor.id, clientSubmissionId: input.clientSubmissionId, request: input })
        .onConflictDoNothing().returning();
      if (!claim) {
        const [receipt] = await tx.select().from(submissionReceipts).where(key);
        if (!receipt || !isDeepStrictEqual(receipt.request, input)) throw new ConflictException('Submission key already used with different content');
        if (!receipt.response) throw new ServiceUnavailableException('Submission result unavailable');
        return receipt.response;
      }
      const scope = and(eq(documentVersions.rosterAssignmentId, input.rosterAssignmentId), eq(documentVersions.documentType, input.documentType));
      const [latest] = await tx.select().from(documentVersions).where(scope).orderBy(desc(documentVersions.version)).limit(1);
      const [approved] = await tx.select({ fields: documentVersions.fields }).from(documentVersions)
        .innerJoin(qcReviews, eq(qcReviews.documentVersionId, documentVersions.id))
        .where(and(scope, eq(qcReviews.decision, 'approve'))).orderBy(desc(documentVersions.version)).limit(1);
      const conflict = approved !== undefined && !isDeepStrictEqual(fields(approved.fields), input.fields);
      const [version] = await tx.insert(documentVersions).values({
        rosterAssignmentId: input.rosterAssignmentId, jobOrderId: record.assignment.jobOrderId,
        documentType: input.documentType, version: (latest?.version ?? 0) + 1,
        fields: input.fields, fileRef: input.fileRef, submittedBy: actor.id,
      }).returning();
      if (!version) throw new Error('Document insert returned no row');
      await audit(tx, actor, { entity: 'document_version', entityId: version.id, field: 'created', oldValue: null, newValue: version });
      if (conflict) await openCorrection(tx, actor, {
        document: version, ownerId: record.assignment.owningCapturistId,
        reason: 'Submitted fields differ from the approved document',
      });
      const response = { documentVersionId: version.id, version: version.version, status: 'pending_review', conflict };
      await tx.update(submissionReceipts).set({ response, documentVersionId: version.id }).where(key);
      return response;
    }, { isolationLevel: 'read committed' });
  }

  review(userId: string | undefined, id: string, input: Review) {
    return this.database.db.transaction(async (tx) => {
      const actor = await caller(tx, userId, 'qc_reviewer');
      const [document] = await tx.select().from(documentVersions).where(eq(documentVersions.id, id));
      if (!document) throw new NotFoundException('Record not found');
      const order = await lockOrder(tx, document.jobOrderId);
      if (order.branchId !== actor.branchId) throw new NotFoundException('Record not found');
      const record = await assignment(tx, document.rosterAssignmentId);
      if (document.submittedBy === actor.id || document.capturedBy === actor.id) {
        throw new ForbiddenException('Independent QC reviewer required');
      }
      const [existing] = await tx.select().from(qcReviews).where(eq(qcReviews.documentVersionId, id));
      if (existing) throw new ConflictException('Document version already reviewed');
      const [review] = await tx.insert(qcReviews).values({ documentVersionId: id, reviewerId: actor.id, ...input }).returning();
      if (!review) throw new Error('Review insert returned no row');
      await audit(tx, actor, { entity: 'qc_review', entityId: review.id, field: 'created', oldValue: null, newValue: review });
      if (input.decision === 'reject') {
        await openCorrection(tx, actor, { document, ownerId: record.assignment.owningCapturistId, reason: input.reason });
      } else {
        await resolveCorrections(tx, actor, document);
      }
      return { documentVersionId: id, status: input.decision === 'approve' ? 'approved' : 'rejected' };
    }, { isolationLevel: 'read committed' });
  }
}
