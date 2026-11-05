import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { DatabaseService } from '../database.service.js';
import { auditLog, jobOrders, rosterAssignments, userRoles, users, workers } from '../database/schema.js';

export type Transaction = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
export async function caller(tx: Transaction, userId: string | undefined, role: typeof userRoles.$inferSelect.role) {
  if (!userId) throw new ForbiddenException('Caller and required role are required');
  const [user] = await tx.select({ id: users.id, branchId: users.branchId }).from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(users.id, userId), eq(users.status, 'active'), eq(userRoles.role, role)));
  if (!user) throw new ForbiddenException('Caller and required role are required');
  return user;
}
export type Caller = Awaited<ReturnType<typeof caller>>;

// ADR-0002: every readiness-changing writer takes the order lock before any write.
export async function lockOrder(tx: Transaction, orderId: string) {
  const [order] = await tx.select().from(jobOrders).where(eq(jobOrders.id, orderId)).for('update');
  if (!order || order.status !== 'active') throw new NotFoundException('Record not found');
  return order;
}
export async function assignment(tx: Transaction, id: string) {
  const [record] = await tx.select({ assignment: rosterAssignments, workerUserId: workers.userId })
    .from(rosterAssignments).innerJoin(workers, eq(workers.id, rosterAssignments.workerId))
    .where(and(eq(rosterAssignments.id, id), eq(rosterAssignments.status, 'active'), isNull(workers.archivedAt)));
  if (!record) throw new NotFoundException('Record not found');
  return record;
}
export async function audit(tx: Transaction, actor: Caller, change: Omit<typeof auditLog.$inferInsert, 'actorId' | 'onBehalfOfUserId'>, onBehalfOfUserId: string | null = null) {
  await tx.insert(auditLog).values({ ...change, actorId: actor.id, onBehalfOfUserId });
}
