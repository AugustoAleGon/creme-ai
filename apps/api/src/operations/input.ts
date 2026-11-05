import { BadRequestException } from '@nestjs/common';
import type { AcceptanceRequest, EmployerDecisionRequest, ScheduleRequest } from '@creme/contracts';

function invalid(): never { throw new BadRequestException('Invalid operations request'); }
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return invalid();
  return value.trim();
}
export function parseEmployerDecision(value: unknown): EmployerDecisionRequest {
  const body = object(value);
  if (Object.keys(body).some((key) => !['evidence', 'decidedOn'].includes(key))) return invalid();
  if (body.evidence !== 'document' && body.evidence !== 'verbal') return invalid();
  const decidedOn = text(body.decidedOn);
  const parsedDate = new Date(`${decidedOn}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(decidedOn) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== decidedOn) return invalid();
  return { evidence: body.evidence, decidedOn };
}
export function parseAcceptance(value: unknown): AcceptanceRequest {
  const body = object(value);
  if (Object.keys(body).some((key) => !['termsVersionId', 'method'].includes(key))) return invalid();
  if (body.method !== 'in_app' && body.method !== 'verbal') return invalid();
  return { termsVersionId: text(body.termsVersionId), method: body.method };
}
export function parseSchedule(value: unknown): ScheduleRequest {
  const body = object(value);
  if (Object.keys(body).some((key) => key !== 'rosterAssignmentIds') || !Array.isArray(body.rosterAssignmentIds) || body.rosterAssignmentIds.length === 0) return invalid();
  const ids: string[] = [];
  for (const id of body.rosterAssignmentIds) {
    if (typeof id !== 'string' || !id.trim()) return invalid();
    ids.push(id.trim());
  }
  return { rosterAssignmentIds: [...new Set(ids)] };
}
