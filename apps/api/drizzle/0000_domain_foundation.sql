CREATE TYPE "public"."acceptance_method" AS ENUM('verbal', 'in_app');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('passport', 'ds160_confirmation', 'signed_contract');--> statement-breakpoint
CREATE TYPE "public"."employer_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."evidence" AS ENUM('document', 'verbal');--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('active', 'archived', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('approve', 'reject');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('capturist', 'qc_reviewer', 'labor_coordinator', 'worker');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'resolved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."terms_status" AS ENUM('current', 'superseded');--> statement-breakpoint
CREATE TABLE "acceptances" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"roster_assignment_id" text NOT NULL,
	"job_order_id" text NOT NULL,
	"terms_version_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"method" "acceptance_method" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acceptance_assignment_terms_unique" UNIQUE("roster_assignment_id","terms_version_id")
);
--> statement-breakpoint
CREATE TABLE "appointment_memberships" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"appointment_id" text NOT NULL,
	"roster_assignment_id" text NOT NULL,
	"job_order_id" text NOT NULL,
	"status" "booking_status" DEFAULT 'scheduled' NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"job_order_id" text NOT NULL,
	"capacity" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_id_order_unique" UNIQUE("id","job_order_id"),
	CONSTRAINT "appointment_positive_capacity" CHECK ("appointments"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"actor_id" text NOT NULL,
	"on_behalf_of_user_id" text,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"field" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"roster_assignment_id" text NOT NULL,
	"job_order_id" text NOT NULL,
	"document_type" "document_type" NOT NULL,
	"version" integer NOT NULL,
	"fields" jsonb NOT NULL,
	"file_ref" text NOT NULL,
	"submitted_by" text NOT NULL,
	"captured_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_assignment_type_version_unique" UNIQUE("roster_assignment_id","document_type","version"),
	CONSTRAINT "document_id_assignment_type_unique" UNIQUE("id","roster_assignment_id","document_type"),
	CONSTRAINT "document_positive_version" CHECK ("document_versions"."version" > 0),
	CONSTRAINT "document_fields_object" CHECK (jsonb_typeof("document_versions"."fields") = 'object'),
	CONSTRAINT "document_file_ref_nonempty" CHECK (length(trim("document_versions"."file_ref")) > 0)
);
--> statement-breakpoint
CREATE TABLE "employer_decisions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"roster_assignment_id" text NOT NULL,
	"decision" "employer_decision" NOT NULL,
	"evidence" "evidence" NOT NULL,
	"decided_on" date NOT NULL,
	"actor_id" text NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qc_reviews" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"document_version_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"decision" "review_decision" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qc_reviews_document_version_id_unique" UNIQUE("document_version_id"),
	CONSTRAINT "review_rejection_reason" CHECK ("qc_reviews"."decision" <> 'reject' OR nullif(trim("qc_reviews"."reason"), '') IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "required_document_types" (
	"job_order_id" text NOT NULL,
	"document_type" "document_type" NOT NULL,
	CONSTRAINT "required_document_types_job_order_id_document_type_pk" PRIMARY KEY("job_order_id","document_type")
);
--> statement-breakpoint
CREATE TABLE "roster_assignments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"worker_id" text NOT NULL,
	"job_order_id" text NOT NULL,
	"owning_capturist_id" text NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_worker_order_unique" UNIQUE("worker_id","job_order_id"),
	CONSTRAINT "assignment_id_order_unique" UNIQUE("id","job_order_id")
);
--> statement-breakpoint
CREATE TABLE "submission_receipts" (
	"user_id" text NOT NULL,
	"client_submission_id" text NOT NULL,
	"request" jsonb NOT NULL,
	"response" jsonb,
	"document_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_receipts_user_id_client_submission_id_pk" PRIMARY KEY("user_id","client_submission_id"),
	CONSTRAINT "submission_key_nonempty" CHECK (length(trim("submission_receipts"."client_submission_id")) > 0),
	CONSTRAINT "submission_request_object" CHECK (jsonb_typeof("submission_receipts"."request") = 'object')
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"roster_assignment_id" text NOT NULL,
	"document_type" "document_type" NOT NULL,
	"source_version_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "terms_versions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"job_order_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" "terms_status" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_order_version_unique" UNIQUE("job_order_id","version"),
	CONSTRAINT "terms_id_order_unique" UNIQUE("id","job_order_id"),
	CONSTRAINT "terms_positive_version" CHECK ("terms_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" text NOT NULL,
	"role" "role" NOT NULL,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"branch_id" text,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_roster_assignment_id_job_order_id_roster_assignments_id_job_order_id_fk" FOREIGN KEY ("roster_assignment_id","job_order_id") REFERENCES "public"."roster_assignments"("id","job_order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_terms_version_id_job_order_id_terms_versions_id_job_order_id_fk" FOREIGN KEY ("terms_version_id","job_order_id") REFERENCES "public"."terms_versions"("id","job_order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_memberships" ADD CONSTRAINT "appointment_memberships_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_memberships" ADD CONSTRAINT "appointment_memberships_appointment_id_job_order_id_appointments_id_job_order_id_fk" FOREIGN KEY ("appointment_id","job_order_id") REFERENCES "public"."appointments"("id","job_order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_memberships" ADD CONSTRAINT "appointment_memberships_roster_assignment_id_job_order_id_roster_assignments_id_job_order_id_fk" FOREIGN KEY ("roster_assignment_id","job_order_id") REFERENCES "public"."roster_assignments"("id","job_order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_job_order_id_job_orders_id_fk" FOREIGN KEY ("job_order_id") REFERENCES "public"."job_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_on_behalf_of_user_id_users_id_fk" FOREIGN KEY ("on_behalf_of_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_roster_assignment_id_job_order_id_roster_assignments_id_job_order_id_fk" FOREIGN KEY ("roster_assignment_id","job_order_id") REFERENCES "public"."roster_assignments"("id","job_order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_job_order_id_document_type_required_document_types_job_order_id_document_type_fk" FOREIGN KEY ("job_order_id","document_type") REFERENCES "public"."required_document_types"("job_order_id","document_type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employer_decisions" ADD CONSTRAINT "employer_decisions_roster_assignment_id_roster_assignments_id_fk" FOREIGN KEY ("roster_assignment_id") REFERENCES "public"."roster_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employer_decisions" ADD CONSTRAINT "employer_decisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "required_document_types" ADD CONSTRAINT "required_document_types_job_order_id_job_orders_id_fk" FOREIGN KEY ("job_order_id") REFERENCES "public"."job_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_assignments" ADD CONSTRAINT "roster_assignments_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_assignments" ADD CONSTRAINT "roster_assignments_job_order_id_job_orders_id_fk" FOREIGN KEY ("job_order_id") REFERENCES "public"."job_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_assignments" ADD CONSTRAINT "roster_assignments_owning_capturist_id_users_id_fk" FOREIGN KEY ("owning_capturist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_receipts" ADD CONSTRAINT "submission_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_receipts" ADD CONSTRAINT "submission_receipts_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_roster_assignment_id_roster_assignments_id_fk" FOREIGN KEY ("roster_assignment_id") REFERENCES "public"."roster_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_version_id_roster_assignment_id_document_type_document_versions_id_roster_assignment_id_document_type_fk" FOREIGN KEY ("source_version_id","roster_assignment_id","document_type") REFERENCES "public"."document_versions"("id","roster_assignment_id","document_type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_versions" ADD CONSTRAINT "terms_versions_job_order_id_job_orders_id_fk" FOREIGN KEY ("job_order_id") REFERENCES "public"."job_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "membership_one_active_assignment" ON "appointment_memberships" USING btree ("roster_assignment_id") WHERE "appointment_memberships"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "memberships_appointment_status_idx" ON "appointment_memberships" USING btree ("appointment_id","status");--> statement-breakpoint
CREATE INDEX "audit_entity_history_idx" ON "audit_log" USING btree ("entity","entity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "employer_one_current_decision" ON "employer_decisions" USING btree ("roster_assignment_id") WHERE "employer_decisions"."superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "assignments_order_idx" ON "roster_assignments" USING btree ("job_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_one_open_correction" ON "tasks" USING btree ("roster_assignment_id","document_type") WHERE "tasks"."status" = 'open';--> statement-breakpoint
CREATE INDEX "tasks_owner_status_idx" ON "tasks" USING btree ("owner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "terms_one_current_per_order" ON "terms_versions" USING btree ("job_order_id") WHERE "terms_versions"."status" = 'current';