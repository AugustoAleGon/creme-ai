import { and, eq } from 'drizzle-orm';
import { tasks, type documentVersions } from '../database/schema.js';
import { audit, type Caller, type Transaction } from './transaction.js';

export async function openCorrection(
  tx: Transaction, actor: Caller,
  input: { document: typeof documentVersions.$inferSelect; ownerId: string; reason: string },
) {
  const [task] = await tx.insert(tasks).values({
    rosterAssignmentId: input.document.rosterAssignmentId, documentType: input.document.documentType,
    sourceVersionId: input.document.id, ownerId: input.ownerId, reason: input.reason,
  }).onConflictDoNothing().returning();
  // R3/R6/R7: keep one open task and do not audit a no-op.
  if (task) await audit(tx, actor, { entity: 'task', entityId: task.id, field: 'created', oldValue: null, newValue: task });
}

export async function resolveCorrections(tx: Transaction, actor: Caller, document: typeof documentVersions.$inferSelect) {
  const open = await tx.select().from(tasks).where(and(
    eq(tasks.rosterAssignmentId, document.rosterAssignmentId), eq(tasks.documentType, document.documentType), eq(tasks.status, 'open'),
  ));
  for (const task of open) {
    const [resolved] = await tx.update(tasks).set({ status: 'resolved', resolvedAt: new Date() }).where(eq(tasks.id, task.id)).returning();
    if (!resolved) throw new Error('Task update returned no row');
    await audit(tx, actor, { entity: 'task', entityId: task.id, field: 'status', oldValue: task, newValue: resolved });
  }
}
