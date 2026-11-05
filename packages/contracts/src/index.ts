export interface HealthResponse {
  status: 'ok';
  database: 'connected';
}

export interface ReadinessGate {
  passed: boolean;
  reason: string;
}

export interface AssignmentReadiness {
  rosterAssignmentId: string;
  workerId: string;
  workerName: string;
  ready: boolean;
  gates: {
    employerApproval: ReadinessGate;
    acceptance: ReadinessGate;
    documents: ReadinessGate;
    qc: ReadinessGate;
  };
  scheduledAppointmentId: string | null;
}

export interface AppointmentSummary {
  id: string;
  startsAt: string;
  capacity: number;
  remainingCapacity: number;
}

export interface ReadinessResponse {
  jobOrderId: string;
  currentTermsVersionId: string | null;
  assignments: AssignmentReadiness[];
  appointments: AppointmentSummary[];
}

export interface ScheduleRequest {
  rosterAssignmentIds: string[];
}

export type ScheduleResult =
  | { rosterAssignmentId: string; status: 'scheduled' | 'already_scheduled' }
  | { rosterAssignmentId: string; status: 'refused'; reasons: string[] };

export interface ScheduleResponse {
  appointmentId: string;
  remainingCapacity: number;
  results: ScheduleResult[];
}

export interface EmployerDecisionRequest {
  evidence: 'document' | 'verbal';
  decidedOn: string;
}

export interface EmployerDecisionResponse extends EmployerDecisionRequest {
  rosterAssignmentId: string;
  decision: 'approved';
}

export interface AcceptanceRequest {
  termsVersionId: string;
  method: 'verbal' | 'in_app';
}

export interface AcceptanceResponse extends AcceptanceRequest {
  rosterAssignmentId: string;
}
