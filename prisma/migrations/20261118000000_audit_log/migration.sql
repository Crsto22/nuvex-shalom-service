-- Auditoria de cambios administrativos.

CREATE TABLE "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid,
  "actor" varchar(80) NOT NULL,
  "action" varchar(60) NOT NULL,
  "target" varchar(120),
  "metadata" jsonb,
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log" ("tenant_id", "created_at");
CREATE INDEX "audit_log_action_created_at_idx" ON "audit_log" ("action", "created_at");
