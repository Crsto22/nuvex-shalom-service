-- Evita encolar dos trabajos de rastreo para la misma orden.
CREATE UNIQUE INDEX "shalom_job_tracking_pending_uniq"
ON "shalom_job" ((payload ->> 'orderId'))
WHERE "type" = 'TRACKING' AND "status" IN ('PENDING', 'PROCESSING');

-- Acelera el barrido de ordenes activas.
CREATE INDEX "shalom_order_tracking_idx"
ON "shalom_order" ("status", "last_tracked_at");
