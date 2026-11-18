-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "ShalomSessionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REQUIERE_LOGIN_MANUAL');

-- CreateEnum
CREATE TYPE "ShalomJobType" AS ENUM ('REGISTER_ORDER', 'TRACKING');

-- CreateEnum
CREATE TYPE "ShalomJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "ShalomOrderStatus" AS ENUM ('REGISTRADO', 'EN_ORIGEN', 'EN_TRANSITO', 'ENTREGADO', 'INCIDENCIA', 'ANULADO');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "max_orders_per_day" INTEGER NOT NULL DEFAULT 200,
    "window_start" VARCHAR(5) NOT NULL DEFAULT '07:00',
    "window_end" VARCHAR(5) NOT NULL DEFAULT '21:00',
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'America/Lima',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shalom_credential" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "username" VARCHAR(160) NOT NULL,
    "encrypted_password" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shalom_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shalom_session" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encrypted_storage_state" TEXT NOT NULL,
    "status" "ShalomSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(500),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shalom_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "prefix" VARCHAR(20) NOT NULL,
    "hashed_key" VARCHAR(64) NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'PRODUCTION',
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shalom_job" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID,
    "type" "ShalomJobType" NOT NULL,
    "status" "ShalomJobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error_message" VARCHAR(500),
    "idempotency_key" VARCHAR(120),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_by" VARCHAR(80),
    "locked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "shalom_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shalom_order" (
    "id" VARCHAR(30) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID,
    "external_ref" VARCHAR(60),
    "orden" VARCHAR(20),
    "codigo" VARCHAR(10),
    "monto" DECIMAL(10,2),
    "status" "ShalomOrderStatus" NOT NULL DEFAULT 'REGISTRADO',
    "destinatario_doc" VARCHAR(12) NOT NULL,
    "origen" VARCHAR(120) NOT NULL,
    "destino" VARCHAR(120) NOT NULL,
    "paquete" VARCHAR(40) NOT NULL,
    "tracking_status" VARCHAR(120),
    "tracking_progress" INTEGER,
    "last_tracked_at" TIMESTAMPTZ(6),
    "registered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shalom_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shalom_event" (
    "id" UUID NOT NULL,
    "order_id" VARCHAR(30) NOT NULL,
    "status" VARCHAR(120) NOT NULL,
    "progress" INTEGER,
    "description" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shalom_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoint" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "secret" VARCHAR(120) NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_delivery" (
    "id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "event" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(6),

    CONSTRAINT "webhook_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_code_key" ON "tenant"("code");

-- CreateIndex
CREATE UNIQUE INDEX "shalom_credential_tenant_id_key" ON "shalom_credential"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "shalom_session_tenant_id_key" ON "shalom_session"("tenant_id");

-- CreateIndex
CREATE INDEX "application_tenant_id_status_idx" ON "application"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "application_tenant_id_code_key" ON "application"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_hashed_key_key" ON "api_key"("hashed_key");

-- CreateIndex
CREATE INDEX "api_key_application_id_revoked_at_idx" ON "api_key"("application_id", "revoked_at");

-- CreateIndex
CREATE INDEX "shalom_job_status_next_attempt_at_idx" ON "shalom_job"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "shalom_job_tenant_id_status_idx" ON "shalom_job"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shalom_job_tenant_id_idempotency_key_key" ON "shalom_job"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "shalom_order_tenant_id_status_idx" ON "shalom_order"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shalom_order_tenant_id_external_ref_key" ON "shalom_order"("tenant_id", "external_ref");

-- CreateIndex
CREATE UNIQUE INDEX "shalom_order_tenant_id_orden_key" ON "shalom_order"("tenant_id", "orden");

-- CreateIndex
CREATE INDEX "shalom_event_order_id_created_at_idx" ON "shalom_event"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_endpoint_application_id_active_idx" ON "webhook_endpoint"("application_id", "active");

-- CreateIndex
CREATE INDEX "webhook_delivery_status_created_at_idx" ON "webhook_delivery"("status", "created_at");

-- AddForeignKey
ALTER TABLE "shalom_credential" ADD CONSTRAINT "shalom_credential_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shalom_session" ADD CONSTRAINT "shalom_session_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application" ADD CONSTRAINT "application_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shalom_job" ADD CONSTRAINT "shalom_job_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shalom_job" ADD CONSTRAINT "shalom_job_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shalom_order" ADD CONSTRAINT "shalom_order_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shalom_event" ADD CONSTRAINT "shalom_event_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shalom_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

