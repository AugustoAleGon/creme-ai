import { BadRequestException } from '@nestjs/common';
import { documentType, reviewDecision } from '../database/schema.js';

function invalid(): never { throw new BadRequestException('Invalid document request'); }
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return invalid();
  return value;
}
export function fields(value: unknown): Record<string, string> {
  const entries = Object.entries(object(value));
  if (!entries.length) return invalid();
  return Object.fromEntries(entries.map(([key, entry]) => [text(key), text(entry).trim()]));
}
export function parseSubmission(value: unknown) {
  const body = object(value);
  const keys = ['clientSubmissionId', 'rosterAssignmentId', 'documentType', 'fields', 'fileRef'];
  if (Object.keys(body).some((key) => !keys.includes(key))) return invalid();
  const type = documentType.enumValues.find((type) => type === body.documentType);
  if (!type) return invalid();
  return {
    clientSubmissionId: text(body.clientSubmissionId), rosterAssignmentId: text(body.rosterAssignmentId),
    documentType: type, fields: fields(body.fields), fileRef: text(body.fileRef).trim(),
  };
}
export type Submission = ReturnType<typeof parseSubmission>;

export type Review = { decision: 'approve'; reason: string | null } | { decision: 'reject'; reason: string };
export function parseReview(value: unknown): Review {
  const body = object(value);
  if (Object.keys(body).some((key) => !['decision', 'reason'].includes(key))) return invalid();
  const decision = reviewDecision.enumValues.find((decision) => decision === body.decision);
  if (!decision) return invalid();
  const reason = body.reason === undefined ? null : text(body.reason).trim();
  if (decision === 'reject') {
    if (!reason) return invalid();
    return { decision, reason };
  }
  return { decision, reason };
}
