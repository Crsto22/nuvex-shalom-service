-- Soporte de reintentos y leases para entregas de webhooks.

ALTER TYPE "WebhookDeliveryStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

ALTER TABLE "webhook_delivery"
  ADD COLUMN IF NOT EXISTS "max_attempts" integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamptz(6) NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "locked_by" varchar(80),
  ADD COLUMN IF NOT EXISTS "locked_at" timestamptz(6);

CREATE INDEX IF NOT EXISTS "webhook_delivery_status_next_attempt_at_idx"
  ON "webhook_delivery" ("status", "next_attempt_at");

CREATE INDEX IF NOT EXISTS "webhook_delivery_endpoint_id_created_at_idx"
  ON "webhook_delivery" ("endpoint_id", "created_at");
