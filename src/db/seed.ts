import type { Transaction } from "sequelize";
import { env } from "../config/env.js";
import { rolePermissions } from "../permissions/permissions.js";
import { encryptSecret } from "../services/credentials.service.js";
import { hashPassword } from "../utils/password.js";
import { sequelize } from "./sequelize.js";

const adminId = "usr_seed_admin";
const managerId = "usr_seed_manager";
const staffId = "usr_seed_staff";
const customerId = "cus_seed_sample";
const submissionId = "SUB-SEED-1001";

const portals = [
  { id: "por_seed_motor", name: "Test Portal A", loginUrl: "https://portal-a.example.test/login", portalType: "motor", health: "healthy", successRate: 96 },
  { id: "por_seed_property", name: "Test Portal B", loginUrl: "https://portal-b.example.test/login", portalType: "property", health: "healthy", successRate: 91 },
  { id: "por_seed_general", name: "Test Portal C", loginUrl: "https://portal-c.example.test/login", portalType: "general", health: "degraded", successRate: 82 }
] as const;

function json(value: unknown) {
  return JSON.stringify(value);
}

async function hasTable(tableName: string, transaction: Transaction) {
  const [rows] = await sequelize.query(
    "SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?;",
    { replacements: [tableName], transaction }
  );
  return Number((rows as Array<{ count: number }>)[0]?.count ?? 0) > 0;
}

async function hasColumn(tableName: string, columnName: string, transaction: Transaction) {
  const [rows] = await sequelize.query(
    "SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?;",
    { replacements: [tableName, columnName], transaction }
  );
  return Number((rows as Array<{ count: number }>)[0]?.count ?? 0) > 0;
}

async function seedUsers(transaction: Transaction) {
  if (!env.SEED_ADMIN_PASSWORD) {
    throw new Error("SEED_ADMIN_PASSWORD is required to seed development users.");
  }

  const passwordHash = await hashPassword(env.SEED_ADMIN_PASSWORD);
  const authSchemaReady = await hasColumn("users", "failed_login_attempts", transaction)
    && await hasColumn("users", "locked_until", transaction)
    && await hasTable("auth_sessions", transaction);
  const authResetSql = authSchemaReady
    ? `,
        failed_login_attempts = 0,
        locked_until = NULL`
    : "";

  await sequelize.query(
    `
      INSERT INTO users (id, email, name, password_hash, role, status, permissions, must_change_password)
      VALUES (?, ?, 'Development Admin', ?, 'admin', 'active', CAST(? AS JSON), false)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        password_hash = VALUES(password_hash),
        role = VALUES(role),
        status = VALUES(status),
        permissions = VALUES(permissions),
        must_change_password = VALUES(must_change_password)${authResetSql};
    `,
    { replacements: [adminId, env.SEED_ADMIN_EMAIL, passwordHash, json(rolePermissions.admin)], transaction }
  );

  await sequelize.query(
    `
      INSERT INTO users (id, email, name, password_hash, role, status, permissions, must_change_password)
      VALUES
        (?, 'manager@example.test', 'Seed Manager', ?, 'manager', 'active', CAST(? AS JSON), false),
        (?, 'staff@example.test', 'Seed Staff', ?, 'staff', 'active', CAST(? AS JSON), false)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        password_hash = VALUES(password_hash),
        role = VALUES(role),
        status = VALUES(status),
        permissions = VALUES(permissions),
        must_change_password = VALUES(must_change_password)${authResetSql};
    `,
    {
      replacements: [
        managerId,
        passwordHash,
        json(rolePermissions.manager),
        staffId,
        passwordHash,
        json(rolePermissions.staff)
      ],
      transaction
    }
  );

  if (authSchemaReady) {
    await sequelize.query(
      "DELETE FROM auth_sessions WHERE user_id IN (?, ?, ?);",
      { replacements: [adminId, managerId, staffId], transaction }
    );
  }
}

async function seedPortals(transaction: Transaction) {
  for (const portal of portals) {
    await sequelize.query(
      `
        INSERT INTO portals (id, name, login_url, portal_type, health, success_rate, is_active, last_health_check)
        VALUES (?, ?, ?, ?, ?, ?, true, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          login_url = VALUES(login_url),
          portal_type = VALUES(portal_type),
          health = VALUES(health),
          success_rate = VALUES(success_rate),
          is_active = VALUES(is_active),
          last_health_check = VALUES(last_health_check);
      `,
      { replacements: [portal.id, portal.name, portal.loginUrl, portal.portalType, portal.health, portal.successRate], transaction }
    );

    await sequelize.query(
      `
        INSERT INTO portal_credentials (
          id,
          portal_id,
          username_ciphertext,
          password_ciphertext,
          totp_seed_ciphertext,
          encryption_key_version,
          rotated_at
        )
        VALUES (?, ?, ?, ?, NULL, 'seed-v1', CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          username_ciphertext = VALUES(username_ciphertext),
          password_ciphertext = VALUES(password_ciphertext),
          totp_seed_ciphertext = VALUES(totp_seed_ciphertext),
          encryption_key_version = VALUES(encryption_key_version),
          rotated_at = VALUES(rotated_at);
      `,
      {
        replacements: [
          `cred_${portal.id}`,
          portal.id,
          encryptSecret(`seed-user-${portal.id}`),
          encryptSecret(`seed-password-${portal.id}`)
        ],
        transaction
      }
    );
  }
}

async function seedSubmission(transaction: Transaction) {
  await sequelize.query(
    `
      INSERT INTO customers (id, full_name, date_of_birth, email, phone, address, created_by)
      VALUES (?, 'Sample Customer', '1990-01-15', 'sample.customer@example.test', '+10000000000', '123 Test Street, Example City', ?)
      ON DUPLICATE KEY UPDATE
        full_name = VALUES(full_name),
        email = VALUES(email),
        phone = VALUES(phone),
        address = VALUES(address);
    `,
    { replacements: [customerId, adminId], transaction }
  );

  await sequelize.query(
    `
      INSERT INTO submissions (
        id,
        customer_id,
        customer,
        coverage_type,
        risk_details,
        status,
        portal_count,
        document_count,
        confidence,
        created_by
      )
      VALUES (?, ?, 'Sample Customer', 'Motor Fleet', CAST(? AS JSON), 'queued', 3, 1, 0, ?)
      ON DUPLICATE KEY UPDATE
        coverage_type = VALUES(coverage_type),
        risk_details = VALUES(risk_details),
        status = VALUES(status),
        portal_count = VALUES(portal_count),
        document_count = VALUES(document_count),
        confidence = VALUES(confidence);
    `,
    {
      replacements: [
        submissionId,
        customerId,
        json({ vehicleCount: 3, businessCategory: "Sample logistics", notes: "Fictional seed submission" }),
        adminId
      ],
      transaction
    }
  );

  await sequelize.query(
    `
      INSERT INTO submission_documents (
        id,
        submission_id,
        filename,
        cloudinary_public_id,
        cloudinary_url,
        document_type,
        uploaded_by
      )
      VALUES (
        'doc_seed_vehicle_schedule',
        ?,
        'vehicle-schedule.pdf',
        'seed/submissions/SUB-SEED-1001/documents/vehicle-schedule',
        'https://res.cloudinary.com/demo/raw/upload/vehicle-schedule.pdf',
        'pdf',
        ?
      )
      ON DUPLICATE KEY UPDATE
        filename = VALUES(filename),
        cloudinary_public_id = VALUES(cloudinary_public_id),
        cloudinary_url = VALUES(cloudinary_url),
        document_type = VALUES(document_type);
    `,
    { replacements: [submissionId, adminId], transaction }
  );
}

async function seedPortalJobs(transaction: Transaction) {
  for (const [index, portal] of portals.entries()) {
    const portalJobId = `JOB-SEED-${index + 1}`;
    const payload = {
      payloadVersion: "v1",
      portalJobId,
      submissionId,
      portalId: portal.id,
      customerId,
      documentUrls: ["https://res.cloudinary.com/demo/raw/upload/vehicle-schedule.pdf"]
    };

    await sequelize.query(
      `
        INSERT INTO portal_jobs (
          id,
          submission_id,
          portal_id,
          status,
          queue_job_id,
          payload_version,
          job_payload,
          step,
          confidence,
          attempts
        )
        VALUES (?, ?, ?, 'queued', ?, 'v1', CAST(? AS JSON), 'Queued', 0, 0)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          queue_job_id = VALUES(queue_job_id),
          payload_version = VALUES(payload_version),
          job_payload = VALUES(job_payload),
          step = VALUES(step),
          confidence = VALUES(confidence);
      `,
      {
        replacements: [
          portalJobId,
          submissionId,
          portal.id,
          `portal-jobs:${portalJobId}:seed`,
          json(payload)
        ],
        transaction
      }
    );
  }
}

async function seedAgentArtifacts(transaction: Transaction) {
  await sequelize.query(
    `
      INSERT INTO agent_actions (
        id,
        portal_job_id,
        action_type,
        confidence_score,
        action_payload,
        before_screenshot_url,
        after_screenshot_url,
        status,
        executed_by
      )
      VALUES (
        'act_seed_dom_observed',
        'JOB-SEED-1',
        'dom_observed',
        92.00,
        CAST(? AS JSON),
        NULL,
        'https://res.cloudinary.com/demo/image/upload/sample-after.png',
        'success',
        'agent'
      )
      ON DUPLICATE KEY UPDATE
        confidence_score = VALUES(confidence_score),
        action_payload = VALUES(action_payload),
        status = VALUES(status);
    `,
    { replacements: [json({ selectorsMatched: 4, credentialsIncluded: false })], transaction }
  );

  await sequelize.query(
    `
      INSERT INTO dom_snapshots (
        id,
        portal_id,
        portal_job_id,
        url,
        step,
        sanitized_dom,
        visible_labels,
        fingerprint
      )
      VALUES (
        'dom_seed_001',
        'por_seed_motor',
        'JOB-SEED-1',
        'https://portal-a.example.test/quote',
        'risk_details',
        '<form><label>Business category</label><input /><label>Vehicle count</label><input /></form>',
        CAST(? AS JSON),
        'sha256:seed001'
      )
      ON DUPLICATE KEY UPDATE
        sanitized_dom = VALUES(sanitized_dom),
        visible_labels = VALUES(visible_labels),
        fingerprint = VALUES(fingerprint);
    `,
    { replacements: [json(["Business category", "Vehicle count"])], transaction }
  );

  await sequelize.query(
    `
      INSERT INTO escalations (
        id,
        portal_job_id,
        submission_id,
        agent_action_id,
        reason,
        suggested_action,
        status,
        confidence,
        screenshot_url,
        resolution_payload
      )
      VALUES (
        'ESC-SEED-1',
        'JOB-SEED-1',
        ?,
        'act_seed_dom_observed',
        'Portal DOM changed: deterministic field match needs operator review',
        'Map visible label Business category to internal risk_class',
        'pending',
        62,
        'https://res.cloudinary.com/demo/image/upload/sample-after.png',
        NULL
      )
      ON DUPLICATE KEY UPDATE
        reason = VALUES(reason),
        suggested_action = VALUES(suggested_action),
        status = VALUES(status),
        confidence = VALUES(confidence),
        screenshot_url = VALUES(screenshot_url);
    `,
    { replacements: [submissionId], transaction }
  );
}

async function run() {
  await sequelize.transaction(async (transaction) => {
    await seedUsers(transaction);
    await seedPortals(transaction);
    await seedSubmission(transaction);
    await seedPortalJobs(transaction);
    await seedAgentArtifacts(transaction);
  });
  console.log("Seed data applied");
}

try {
  await run();
  await sequelize.close();
} catch (error) {
  console.error(error);
  await sequelize.close();
  process.exit(1);
}
