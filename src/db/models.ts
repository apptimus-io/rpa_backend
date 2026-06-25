import { DataTypes, Model } from "sequelize";
import { sequelize } from "./sequelize.js";

export class User extends Model {}
User.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    passwordHash: { field: "password_hash", type: DataTypes.STRING(255), allowNull: false },
    role: { type: DataTypes.STRING(50), allowNull: false },
    status: { type: DataTypes.STRING(50), allowNull: false },
    permissions: { type: DataTypes.JSON, allowNull: false },
    mustChangePassword: { field: "must_change_password", type: DataTypes.BOOLEAN, allowNull: false },
    mfaSecretCiphertext: { field: "mfa_secret_ciphertext", type: DataTypes.TEXT, allowNull: true },
    lastLoginAt: { field: "last_login_at", type: DataTypes.DATE, allowNull: true },
    failedLoginAttempts: { field: "failed_login_attempts", type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    lockedUntil: { field: "locked_until", type: DataTypes.DATE, allowNull: true }
  },
  {
    sequelize,
    tableName: "users",
    underscored: true,
    indexes: [
      { fields: ["role"], name: "users_role_idx" },
      { fields: ["status"], name: "users_status_idx" },
      { fields: ["locked_until"], name: "users_locked_until_idx" },
      { fields: ["created_at"], name: "users_created_at_idx" }
    ]
  }
);

export class AuthSession extends Model {}
AuthSession.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    userId: { field: "user_id", type: DataTypes.STRING(32), allowNull: false },
    refreshTokenHash: { field: "refresh_token_hash", type: DataTypes.STRING(255), allowNull: false, unique: true },
    expiresAt: { field: "expires_at", type: DataTypes.DATE, allowNull: false },
    revokedAt: { field: "revoked_at", type: DataTypes.DATE, allowNull: true },
    lastUsedAt: { field: "last_used_at", type: DataTypes.DATE, allowNull: true }
  },
  {
    sequelize,
    tableName: "auth_sessions",
    underscored: true,
    indexes: [
      { fields: ["user_id"], name: "auth_sessions_user_id_idx" },
      { fields: ["expires_at"], name: "auth_sessions_expires_at_idx" },
      { fields: ["revoked_at"], name: "auth_sessions_revoked_at_idx" }
    ]
  }
);

export class Portal extends Model {}
Portal.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    loginUrl: { field: "login_url", type: DataTypes.STRING(2048), allowNull: false },
    portalType: { field: "portal_type", type: DataTypes.STRING(100), allowNull: false },
    quotationUrl: { field: "quotation_url", type: DataTypes.STRING(2048), allowNull: true },
    loginType: { field: "login_type", type: DataTypes.STRING(50), allowNull: false, defaultValue: "credentials" },
    workflowType: { field: "workflow_type", type: DataTypes.STRING(50), allowNull: false, defaultValue: "hybrid" },
    censusDownloadRequired: { field: "census_download_required", type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    calculateRequired: { field: "calculate_required", type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    quotePdfStrategy: { field: "quote_pdf_strategy", type: DataTypes.STRING(80), allowNull: false, defaultValue: "direct_download" },
    portalConfig: { field: "portal_config", type: DataTypes.JSON, allowNull: true },
    health: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "healthy" },
    successRate: { field: "success_rate", type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    isActive: { field: "is_active", type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    lastHealthCheck: { field: "last_health_check", type: DataTypes.DATE, allowNull: true }
  },
  { sequelize, tableName: "portals", underscored: true }
);

export class PortalCredential extends Model {}
PortalCredential.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    portalId: { field: "portal_id", type: DataTypes.STRING(32), allowNull: false, unique: true },
    usernameCiphertext: { field: "username_ciphertext", type: DataTypes.TEXT, allowNull: false },
    passwordCiphertext: { field: "password_ciphertext", type: DataTypes.TEXT, allowNull: false },
    totpSeedCiphertext: { field: "totp_seed_ciphertext", type: DataTypes.TEXT, allowNull: true },
    encryptionKeyVersion: { field: "encryption_key_version", type: DataTypes.STRING(64), allowNull: false },
    rotatedAt: { field: "rotated_at", type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "portal_credentials", underscored: true }
);

export class CoverageType extends Model {}
CoverageType.init(
    {
      id: { type: DataTypes.STRING(32), primaryKey: true },
      name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      code: { type: DataTypes.STRING(80), allowNull: true, unique: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      config: { type: DataTypes.JSON, allowNull: true },
      isActive: { field: "is_active", type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      sortOrder: { field: "sort_order", type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 }
  },
  {
    sequelize,
    tableName: "coverage_types",
    underscored: true,
    indexes: [
      { fields: ["is_active"], name: "coverage_types_is_active_idx" },
      { fields: ["sort_order"], name: "coverage_types_sort_order_idx" }
    ]
  }
);

export class Customer extends Model {}
Customer.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    fullName: { field: "full_name", type: DataTypes.STRING(255), allowNull: false },
    dateOfBirth: { field: "date_of_birth", type: DataTypes.DATEONLY, allowNull: true },
    email: { type: DataTypes.STRING(255), allowNull: true },
    phone: { type: DataTypes.STRING(50), allowNull: true },
    address: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { field: "created_by", type: DataTypes.STRING(32), allowNull: false }
  },
  {
    sequelize,
    tableName: "customers",
    underscored: true,
    indexes: [
      { fields: ["created_by"], name: "customers_created_by_idx" },
      { fields: ["created_at"], name: "customers_created_at_idx" }
    ]
  }
);

export class Submission extends Model {}
Submission.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    customerId: { field: "customer_id", type: DataTypes.STRING(32), allowNull: true },
    customer: { type: DataTypes.STRING(255), allowNull: false },
    coverageType: { field: "coverage_type", type: DataTypes.STRING(100), allowNull: false },
    riskDetails: { field: "risk_details", type: DataTypes.JSON, allowNull: true },
    status: { type: DataTypes.STRING(50), allowNull: false },
    portalCount: { field: "portal_count", type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    documentCount: { field: "document_count", type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    confidence: { type: DataTypes.INTEGER, allowNull: false },
    createdBy: { field: "created_by", type: DataTypes.STRING(32), allowNull: false }
  },
  { sequelize, tableName: "submissions", underscored: true }
);

export class SubmissionDocument extends Model {}
SubmissionDocument.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    submissionId: { field: "submission_id", type: DataTypes.STRING(32), allowNull: false },
    filename: { type: DataTypes.STRING(255), allowNull: false },
    cloudinaryPublicId: { field: "cloudinary_public_id", type: DataTypes.STRING(255), allowNull: false },
    cloudinaryUrl: { field: "cloudinary_url", type: DataTypes.STRING(2048), allowNull: false },
    documentType: { field: "document_type", type: DataTypes.STRING(100), allowNull: false },
    uploadedBy: { field: "uploaded_by", type: DataTypes.STRING(32), allowNull: false }
  },
  {
    sequelize,
    tableName: "submission_documents",
    underscored: true,
    indexes: [
      { fields: ["submission_id"], name: "submission_documents_submission_id_idx" },
      { fields: ["uploaded_by"], name: "submission_documents_uploaded_by_idx" },
      { fields: ["document_type"], name: "submission_documents_document_type_idx" },
      { fields: ["created_at"], name: "submission_documents_created_at_idx" }
    ]
  }
);

export class SubmissionData extends Model {}
SubmissionData.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    submissionId: { field: "submission_id", type: DataTypes.STRING(32), allowNull: false, unique: true },
    source: { type: DataTypes.STRING(50), allowNull: false },
    sourceFilename: { field: "source_filename", type: DataTypes.STRING(255), allowNull: true },
    companyDetails: { field: "company_details", type: DataTypes.JSON, allowNull: false },
    contactDetails: { field: "contact_details", type: DataTypes.JSON, allowNull: false },
    policyDetails: { field: "policy_details", type: DataTypes.JSON, allowNull: false },
    censusMembers: { field: "census_members", type: DataTypes.JSON, allowNull: false },
    validationErrors: { field: "validation_errors", type: DataTypes.JSON, allowNull: false },
    verificationStatus: { field: "verification_status", type: DataTypes.STRING(50), allowNull: false, defaultValue: "pending_review" },
    verificationNotes: { field: "verification_notes", type: DataTypes.TEXT, allowNull: true },
    assignedTo: { field: "assigned_to", type: DataTypes.STRING(32), allowNull: true },
    verifiedBy: { field: "verified_by", type: DataTypes.STRING(32), allowNull: true },
    verifiedAt: { field: "verified_at", type: DataTypes.DATE, allowNull: true },
    lockedAt: { field: "locked_at", type: DataTypes.DATE, allowNull: true }
  },
  {
    sequelize,
    tableName: "submission_data",
    underscored: true,
    indexes: [
      { fields: ["submission_id"], name: "submission_data_submission_id_idx" },
      { fields: ["source"], name: "submission_data_source_idx" },
      { fields: ["locked_at"], name: "submission_data_locked_at_idx" }
    ]
  }
);

export class CustomerData extends Model {}
CustomerData.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    customerId: { field: "customer_id", type: DataTypes.STRING(32), allowNull: false, unique: true },
    source: { type: DataTypes.STRING(50), allowNull: false },
    sourceFilename: { field: "source_filename", type: DataTypes.STRING(255), allowNull: true },
    companyDetails: { field: "company_details", type: DataTypes.JSON, allowNull: false },
    contactDetails: { field: "contact_details", type: DataTypes.JSON, allowNull: false },
    policyDetails: { field: "policy_details", type: DataTypes.JSON, allowNull: false },
    censusMembers: { field: "census_members", type: DataTypes.JSON, allowNull: false },
    validationErrors: { field: "validation_errors", type: DataTypes.JSON, allowNull: false },
    verificationStatus: { field: "verification_status", type: DataTypes.STRING(50), allowNull: false, defaultValue: "pending_review" },
    verificationNotes: { field: "verification_notes", type: DataTypes.TEXT, allowNull: true },
    assignedTo: { field: "assigned_to", type: DataTypes.STRING(32), allowNull: true },
    verifiedBy: { field: "verified_by", type: DataTypes.STRING(32), allowNull: true },
    verifiedAt: { field: "verified_at", type: DataTypes.DATE, allowNull: true },
    lockedAt: { field: "locked_at", type: DataTypes.DATE, allowNull: true }
  },
  {
    sequelize,
    tableName: "customer_data",
    underscored: true,
    indexes: [
      { fields: ["customer_id"], name: "customer_data_customer_id_idx" },
      { fields: ["source"], name: "customer_data_source_idx" },
      { fields: ["verification_status"], name: "customer_data_verification_status_idx" },
      { fields: ["assigned_to"], name: "customer_data_assigned_to_idx" },
      { fields: ["locked_at"], name: "customer_data_locked_at_idx" }
    ]
  }
);

export class CustomerMember extends Model {}
CustomerMember.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    customerId: { field: "customer_id", type: DataTypes.STRING(32), allowNull: false },
    customerDataId: { field: "customer_data_id", type: DataTypes.STRING(32), allowNull: true },
    employeeNo: { field: "employee_no", type: DataTypes.STRING(100), allowNull: true },
    employeeName: { field: "employee_name", type: DataTypes.STRING(255), allowNull: false },
    firstName: { field: "first_name", type: DataTypes.STRING(120), allowNull: true },
    lastName: { field: "last_name", type: DataTypes.STRING(120), allowNull: true },
    relationship: { type: DataTypes.STRING(100), allowNull: true },
    dateOfBirth: { field: "date_of_birth", type: DataTypes.DATEONLY, allowNull: true },
    age: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    gender: { type: DataTypes.STRING(30), allowNull: true },
    maritalStatus: { field: "marital_status", type: DataTypes.STRING(80), allowNull: true },
    nationality: { type: DataTypes.STRING(120), allowNull: true },
    emiratesLocation: { field: "emirates_location", type: DataTypes.STRING(120), allowNull: true },
    salary: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    salaryBand: { field: "salary_band", type: DataTypes.STRING(120), allowNull: true },
    visaStatus: { field: "visa_status", type: DataTypes.STRING(120), allowNull: true },
    passportNumber: { field: "passport_number", type: DataTypes.STRING(120), allowNull: true },
    mobileNumber: { field: "mobile_number", type: DataTypes.STRING(80), allowNull: true },
    email: { type: DataTypes.STRING(255), allowNull: true },
    category: { type: DataTypes.STRING(120), allowNull: true },
    memberType: { field: "member_type", type: DataTypes.STRING(120), allowNull: true },
    normalizedPayload: { field: "normalized_payload", type: DataTypes.JSON, allowNull: false },
    validationErrors: { field: "validation_errors", type: DataTypes.JSON, allowNull: false },
    importBatchId: { field: "import_batch_id", type: DataTypes.STRING(32), allowNull: true },
    status: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "ready" }
  },
  {
    sequelize,
    tableName: "customer_members",
    underscored: true,
    indexes: [
      { fields: ["customer_id"], name: "customer_members_customer_id_idx" },
      { fields: ["customer_data_id"], name: "customer_members_customer_data_id_idx" },
      { fields: ["import_batch_id"], name: "customer_members_import_batch_id_idx" },
      { fields: ["status"], name: "customer_members_status_idx" }
    ]
  }
);

export class DynamicFieldDefinition extends Model {}
DynamicFieldDefinition.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    fieldName: { field: "field_name", type: DataTypes.STRING(120), allowNull: false, unique: true },
    fieldLabel: { field: "field_label", type: DataTypes.STRING(160), allowNull: false },
    dataType: { field: "data_type", type: DataTypes.STRING(50), allowNull: false, defaultValue: "text" },
    required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    coverageType: { field: "coverage_type", type: DataTypes.STRING(100), allowNull: true },
    insurerMapping: { field: "insurer_mapping", type: DataTypes.JSON, allowNull: true }
  },
  {
    sequelize,
    tableName: "dynamic_field_definitions",
    underscored: true,
    indexes: [
      { fields: ["coverage_type"], name: "dynamic_field_definitions_coverage_type_idx" },
      { fields: ["field_name"], name: "dynamic_field_definitions_field_name_idx" }
    ]
  }
);

export class MemberFieldValue extends Model {}
MemberFieldValue.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    memberId: { field: "member_id", type: DataTypes.STRING(32), allowNull: false },
    fieldId: { field: "field_id", type: DataTypes.STRING(32), allowNull: false },
    value: { type: DataTypes.TEXT, allowNull: true }
  },
  {
    sequelize,
    tableName: "member_field_values",
    underscored: true,
    indexes: [
      { fields: ["member_id"], name: "member_field_values_member_id_idx" },
      { fields: ["field_id"], name: "member_field_values_field_id_idx" },
      { fields: ["member_id", "field_id"], unique: true, name: "member_field_values_member_field_unique" }
    ]
  }
);

export class ExcelMappingTemplate extends Model {}
ExcelMappingTemplate.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    coverageType: { field: "coverage_type", type: DataTypes.STRING(100), allowNull: false },
    portalId: { field: "portal_id", type: DataTypes.STRING(32), allowNull: true },
    mappings: { type: DataTypes.JSON, allowNull: false },
    createdBy: { field: "created_by", type: DataTypes.STRING(32), allowNull: false }
  },
  {
    sequelize,
    tableName: "excel_mapping_templates",
    underscored: true,
    indexes: [
      { fields: ["coverage_type"], name: "excel_mapping_templates_coverage_type_idx" },
      { fields: ["portal_id"], name: "excel_mapping_templates_portal_id_idx" }
    ]
  }
);

export class PortalFieldMapping extends Model {}
PortalFieldMapping.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    portalId: { field: "portal_id", type: DataTypes.STRING(32), allowNull: false },
    coverageType: { field: "coverage_type", type: DataTypes.STRING(100), allowNull: false },
    domSnapshotId: { field: "dom_snapshot_id", type: DataTypes.STRING(32), allowNull: true },
    mappingVersion: { field: "mapping_version", type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    status: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "draft" },
    mappings: { type: DataTypes.JSON, allowNull: false },
    requiredFields: { field: "required_fields", type: DataTypes.JSON, allowNull: false },
    aiSuggested: { field: "ai_suggested", type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    aiModel: { field: "ai_model", type: DataTypes.STRING(100), allowNull: true },
    escalationId: { field: "escalation_id", type: DataTypes.STRING(32), allowNull: true },
    parentMappingId: { field: "parent_mapping_id", type: DataTypes.STRING(32), allowNull: true },
    approvedBy: { field: "approved_by", type: DataTypes.STRING(32), allowNull: true },
    approvedAt: { field: "approved_at", type: DataTypes.DATE, allowNull: true }
  },
  {
    sequelize,
    tableName: "portal_field_mappings",
    underscored: true,
    indexes: [
      { fields: ["portal_id"], name: "portal_field_mappings_portal_id_idx" },
      { fields: ["coverage_type"], name: "portal_field_mappings_coverage_type_idx" },
      { fields: ["status"], name: "portal_field_mappings_status_idx" }
    ]
  }
);

export class PortalTemplate extends Model {}
PortalTemplate.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    portalId: { field: "portal_id", type: DataTypes.STRING(32), allowNull: false },
    name: { type: DataTypes.STRING(255), allowNull: false },
    coverageType: { field: "coverage_type", type: DataTypes.STRING(100), allowNull: false },
    coverageTypeCode: { field: "coverage_type_code", type: DataTypes.STRING(80), allowNull: true },
    templateVersion: { field: "template_version", type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    status: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "draft" },
    workflowType: { field: "workflow_type", type: DataTypes.STRING(50), allowNull: false, defaultValue: "hybrid" },
    domSnapshotIds: { field: "dom_snapshot_ids", type: DataTypes.JSON, allowNull: false },
    fieldMappings: { field: "field_mappings", type: DataTypes.JSON, allowNull: false },
    censusMapping: { field: "census_mapping", type: DataTypes.JSON, allowNull: true },
    dialogRules: { field: "dialog_rules", type: DataTypes.JSON, allowNull: false },
    submitRules: { field: "submit_rules", type: DataTypes.JSON, allowNull: false },
    quoteCaptureRules: { field: "quote_capture_rules", type: DataTypes.JSON, allowNull: false },
    requiredSections: { field: "required_sections", type: DataTypes.JSON, allowNull: false },
    testStatus: { field: "test_status", type: DataTypes.STRING(50), allowNull: false, defaultValue: "not_run" },
    testReport: { field: "test_report", type: DataTypes.JSON, allowNull: true },
    parentTemplateId: { field: "parent_template_id", type: DataTypes.STRING(32), allowNull: true },
    approvedBy: { field: "approved_by", type: DataTypes.STRING(32), allowNull: true },
    approvedAt: { field: "approved_at", type: DataTypes.DATE, allowNull: true }
  },
  {
    sequelize,
    tableName: "portal_templates",
    underscored: true,
    indexes: [
      { fields: ["portal_id"], name: "portal_templates_portal_id_idx" },
      { fields: ["coverage_type"], name: "portal_templates_coverage_type_idx" },
      { fields: ["coverage_type_code"], name: "portal_templates_coverage_type_code_idx" },
      { fields: ["status"], name: "portal_templates_status_idx" },
      { fields: ["portal_id", "coverage_type", "status"], name: "portal_templates_execution_idx" }
    ]
  }
);

export class CensusTemplate extends Model {}
CensusTemplate.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    portalId: { field: "portal_id", type: DataTypes.STRING(32), allowNull: false },
    portalTemplateId: { field: "portal_template_id", type: DataTypes.STRING(32), allowNull: true },
    domSnapshotId: { field: "dom_snapshot_id", type: DataTypes.STRING(32), allowNull: true },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    status: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "observed" },
    filename: { type: DataTypes.STRING(255), allowNull: true },
    fileHash: { field: "file_hash", type: DataTypes.STRING(128), allowNull: false },
    filePublicId: { field: "file_public_id", type: DataTypes.STRING(255), allowNull: true },
    fileUrl: { field: "file_url", type: DataTypes.STRING(2048), allowNull: true },
    sheetName: { field: "sheet_name", type: DataTypes.STRING(255), allowNull: true },
    headers: { type: DataTypes.JSON, allowNull: false },
    columnMapping: { field: "column_mapping", type: DataTypes.JSON, allowNull: true },
    validationRules: { field: "validation_rules", type: DataTypes.JSON, allowNull: true },
    parentTemplateId: { field: "parent_template_id", type: DataTypes.STRING(32), allowNull: true },
    approvedBy: { field: "approved_by", type: DataTypes.STRING(32), allowNull: true },
    approvedAt: { field: "approved_at", type: DataTypes.DATE, allowNull: true }
  },
  {
    sequelize,
    tableName: "census_templates",
    underscored: true,
    indexes: [
      { fields: ["portal_id"], name: "census_templates_portal_id_idx" },
      { fields: ["portal_template_id"], name: "census_templates_portal_template_id_idx" },
      { fields: ["file_hash"], name: "census_templates_file_hash_idx" },
      { fields: ["status"], name: "census_templates_status_idx" }
    ]
  }
);

export class PortalDialog extends Model {}
PortalDialog.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    portalId: { field: "portal_id", type: DataTypes.STRING(32), allowNull: false },
    portalTemplateId: { field: "portal_template_id", type: DataTypes.STRING(32), allowNull: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    triggerStep: { field: "trigger_step", type: DataTypes.STRING(100), allowNull: true },
    detectionPattern: { field: "detection_pattern", type: DataTypes.JSON, allowNull: false },
    observedContent: { field: "observed_content", type: DataTypes.JSON, allowNull: true },
    defaultAction: { field: "default_action", type: DataTypes.STRING(50), allowNull: false, defaultValue: "ESCALATE" },
    approvedAction: { field: "approved_action", type: DataTypes.STRING(50), allowNull: true },
    preconditions: { type: DataTypes.JSON, allowNull: true },
    irreversible: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    status: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "observed" },
    approvedBy: { field: "approved_by", type: DataTypes.STRING(32), allowNull: true },
    approvedAt: { field: "approved_at", type: DataTypes.DATE, allowNull: true }
  },
  {
    sequelize,
    tableName: "portal_dialogs",
    underscored: true,
    indexes: [
      { fields: ["portal_id"], name: "portal_dialogs_portal_id_idx" },
      { fields: ["portal_template_id"], name: "portal_dialogs_portal_template_id_idx" },
      { fields: ["status"], name: "portal_dialogs_status_idx" }
    ]
  }
);

export class InsurerWorkflow extends Model {}
InsurerWorkflow.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    portalId: { field: "portal_id", type: DataTypes.STRING(32), allowNull: false },
    coverageType: { field: "coverage_type", type: DataTypes.STRING(100), allowNull: false },
    workflowMode: { field: "workflow_mode", type: DataTypes.STRING(50), allowNull: false, defaultValue: "individual_entry" },
    uploadMethod: { field: "upload_method", type: DataTypes.STRING(100), allowNull: true },
    quoteDownloadMethod: { field: "quote_download_method", type: DataTypes.STRING(100), allowNull: true },
    templateConfig: { field: "template_config", type: DataTypes.JSON, allowNull: true },
    isActive: { field: "is_active", type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
  },
  {
    sequelize,
    tableName: "insurer_workflows",
    underscored: true,
    indexes: [
      { fields: ["portal_id"], name: "insurer_workflows_portal_id_idx" },
      { fields: ["coverage_type"], name: "insurer_workflows_coverage_type_idx" },
      { fields: ["workflow_mode"], name: "insurer_workflows_workflow_mode_idx" }
    ]
  }
);

export class CustomerIntakeLink extends Model {}
CustomerIntakeLink.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    formTemplateId: { field: "form_template_id", type: DataTypes.STRING(32), allowNull: true },
    tokenHash: { field: "token_hash", type: DataTypes.STRING(128), allowNull: false, unique: true },
    expiresAt: { field: "expires_at", type: DataTypes.DATE, allowNull: false },
    revokedAt: { field: "revoked_at", type: DataTypes.DATE, allowNull: true },
    usedAt: { field: "used_at", type: DataTypes.DATE, allowNull: true },
    createdBy: { field: "created_by", type: DataTypes.STRING(32), allowNull: false }
  },
  {
    sequelize,
    tableName: "customer_intake_links",
    underscored: true,
    indexes: [
      { fields: ["expires_at"], name: "customer_intake_links_expires_at_idx" },
      { fields: ["revoked_at"], name: "customer_intake_links_revoked_at_idx" },
      { fields: ["created_by"], name: "customer_intake_links_created_by_idx" }
    ]
  }
);

export class IntakeFormTemplate extends Model {}
IntakeFormTemplate.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    coverageType: { field: "coverage_type", type: DataTypes.STRING(100), allowNull: true },
    coverageTypeCode: { field: "coverage_type_code", type: DataTypes.STRING(80), allowNull: true },
    formType: { field: "form_type", type: DataTypes.STRING(50), allowNull: false, defaultValue: "company" },
    templateType: { field: "template_type", type: DataTypes.STRING(50), allowNull: true },
    fields: { type: DataTypes.JSON, allowNull: false },
    memberColumns: { field: "member_columns", type: DataTypes.JSON, allowNull: true },
    isDefault: { field: "is_default", type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdBy: { field: "created_by", type: DataTypes.STRING(32), allowNull: false }
  },
  {
    sequelize,
    tableName: "intake_form_templates",
    underscored: true,
    indexes: [
      { fields: ["is_default"], name: "intake_form_templates_is_default_idx" },
      { fields: ["coverage_type"], name: "intake_form_templates_coverage_type_idx" },
      { fields: ["form_type"], name: "intake_form_templates_form_type_idx" },
      { fields: ["created_by"], name: "intake_form_templates_created_by_idx" }
    ]
  }
);

export class PublicIntakeLink extends Model {}
PublicIntakeLink.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    submissionId: { field: "submission_id", type: DataTypes.STRING(32), allowNull: false },
    tokenHash: { field: "token_hash", type: DataTypes.STRING(128), allowNull: false, unique: true },
    expiresAt: { field: "expires_at", type: DataTypes.DATE, allowNull: false },
    revokedAt: { field: "revoked_at", type: DataTypes.DATE, allowNull: true },
    usedAt: { field: "used_at", type: DataTypes.DATE, allowNull: true },
    createdBy: { field: "created_by", type: DataTypes.STRING(32), allowNull: false }
  },
  {
    sequelize,
    tableName: "public_intake_links",
    underscored: true,
    indexes: [
      { fields: ["submission_id"], name: "public_intake_links_submission_id_idx" },
      { fields: ["expires_at"], name: "public_intake_links_expires_at_idx" },
      { fields: ["revoked_at"], name: "public_intake_links_revoked_at_idx" }
    ]
  }
);

export class PortalJob extends Model {}
PortalJob.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    submissionId: { field: "submission_id", type: DataTypes.STRING(32), allowNull: false },
    portalId: { field: "portal_id", type: DataTypes.STRING(32), allowNull: false },
    status: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "queued" },
    queueJobId: { field: "queue_job_id", type: DataTypes.STRING(255), allowNull: true },
    payloadVersion: { field: "payload_version", type: DataTypes.STRING(20), allowNull: false, defaultValue: "v1" },
    jobPayload: { field: "job_payload", type: DataTypes.JSON, allowNull: false },
    step: { type: DataTypes.STRING(255), allowNull: false, defaultValue: "Queued" },
    confidence: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    startedAt: { field: "started_at", type: DataTypes.DATE, allowNull: true },
    completedAt: { field: "completed_at", type: DataTypes.DATE, allowNull: true },
    attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    errorMessage: { field: "error_message", type: DataTypes.TEXT, allowNull: true },
    memberId: { field: "member_id", type: DataTypes.STRING(32), allowNull: true },
    workflowMode: { field: "workflow_mode", type: DataTypes.STRING(50), allowNull: true },
    mappingVersion: { field: "mapping_version", type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    portalTemplateId: { field: "portal_template_id", type: DataTypes.STRING(32), allowNull: true },
    censusTemplateId: { field: "census_template_id", type: DataTypes.STRING(32), allowNull: true }
  },
  {
    sequelize,
    tableName: "portal_jobs",
    underscored: true,
    indexes: [
      { fields: ["status"], name: "portal_jobs_status_idx" },
      { fields: ["portal_id"], name: "portal_jobs_portal_id_idx" },
      { fields: ["submission_id"], name: "portal_jobs_submission_id_idx" },
      { fields: ["portal_template_id"], name: "portal_jobs_portal_template_id_idx" },
      { fields: ["census_template_id"], name: "portal_jobs_census_template_id_idx" },
      { fields: ["queue_job_id"], name: "portal_jobs_queue_job_id_idx" },
      { fields: ["created_at"], name: "portal_jobs_created_at_idx" }
    ]
  }
);

export class AgentAction extends Model {}
AgentAction.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    portalJobId: { field: "portal_job_id", type: DataTypes.STRING(32), allowNull: false },
    actionType: { field: "action_type", type: DataTypes.STRING(100), allowNull: false },
    confidenceScore: { field: "confidence_score", type: DataTypes.DECIMAL(5, 2), allowNull: false },
    actionPayload: { field: "action_payload", type: DataTypes.JSON, allowNull: false },
    beforeScreenshotUrl: { field: "before_screenshot_url", type: DataTypes.STRING(2048), allowNull: true },
    afterScreenshotUrl: { field: "after_screenshot_url", type: DataTypes.STRING(2048), allowNull: true },
    status: { type: DataTypes.STRING(50), allowNull: false },
    executedBy: { field: "executed_by", type: DataTypes.STRING(100), allowNull: false }
  },
  {
    sequelize,
    tableName: "agent_actions",
    underscored: true,
    indexes: [
      { fields: ["portal_job_id"], name: "agent_actions_portal_job_id_idx" },
      { fields: ["action_type"], name: "agent_actions_action_type_idx" },
      { fields: ["status"], name: "agent_actions_status_idx" },
      { fields: ["created_at"], name: "agent_actions_created_at_idx" }
    ]
  }
);

export class DomSnapshot extends Model {}
DomSnapshot.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    portalId: { field: "portal_id", type: DataTypes.STRING(32), allowNull: false },
    portalJobId: { field: "portal_job_id", type: DataTypes.STRING(32), allowNull: true },
    url: { type: DataTypes.STRING(2048), allowNull: false },
    step: { type: DataTypes.STRING(100), allowNull: false },
    sanitizedDom: { field: "sanitized_dom", type: DataTypes.TEXT("long"), allowNull: false },
    visibleLabels: { field: "visible_labels", type: DataTypes.JSON, allowNull: false },
    fingerprint: { type: DataTypes.STRING(128), allowNull: false },
    domVersion: { field: "dom_version", type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    parentSnapshotId: { field: "parent_snapshot_id", type: DataTypes.STRING(32), allowNull: true },
    routeFingerprint: { field: "route_fingerprint", type: DataTypes.STRING(128), allowNull: true },
    status: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "observed" },
    changeReport: { field: "change_report", type: DataTypes.JSON, allowNull: true },
    frameCount: { field: "frame_count", type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    frameMetadata: { field: "frame_metadata", type: DataTypes.JSON, allowNull: true }
  },
  {
    sequelize,
    tableName: "dom_snapshots",
    underscored: true,
    indexes: [
      { fields: ["portal_id"], name: "dom_snapshots_portal_id_idx" },
      { fields: ["portal_job_id"], name: "dom_snapshots_portal_job_id_idx" },
      { fields: ["fingerprint"], name: "dom_snapshots_fingerprint_idx" },
      { fields: ["route_fingerprint"], name: "dom_snapshots_route_fingerprint_idx" },
      { fields: ["status"], name: "dom_snapshots_status_idx" },
      { fields: ["portal_id", "step", "route_fingerprint", "dom_version"], name: "dom_snapshots_version_idx" },
      { fields: ["created_at"], name: "dom_snapshots_created_at_idx" }
    ]
  }
);

export class Quote extends Model {}
export class PortalObservationSession extends Model {}
PortalObservationSession.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    portalId: { field: "portal_id", type: DataTypes.STRING(32), allowNull: false },
    coverageType: { field: "coverage_type", type: DataTypes.STRING(100), allowNull: true },
    status: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "recording" },
    startedBy: { field: "started_by", type: DataTypes.STRING(32), allowNull: true },
    startedAt: { field: "started_at", type: DataTypes.DATE, allowNull: false },
    completedAt: { field: "completed_at", type: DataTypes.DATE, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    draftMappingId: { field: "draft_mapping_id", type: DataTypes.STRING(32), allowNull: true }
  },
  {
    sequelize,
    tableName: "portal_observation_sessions",
    underscored: true,
    indexes: [
      { fields: ["portal_id"], name: "portal_observation_sessions_portal_id_idx" },
      { fields: ["status"], name: "portal_observation_sessions_status_idx" },
      { fields: ["draft_mapping_id"], name: "portal_observation_sessions_draft_mapping_id_idx" }
    ]
  }
);

export class PortalObservationEvent extends Model {}
PortalObservationEvent.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    sessionId: { field: "session_id", type: DataTypes.STRING(32), allowNull: false },
    eventIndex: { field: "event_index", type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    eventType: { field: "event_type", type: DataTypes.STRING(50), allowNull: false },
    step: { type: DataTypes.STRING(100), allowNull: true },
    url: { type: DataTypes.STRING(2048), allowNull: true },
    fieldLabel: { field: "field_label", type: DataTypes.STRING(255), allowNull: true },
    fieldType: { field: "field_type", type: DataTypes.STRING(50), allowNull: true },
    normalizedTarget: { field: "normalized_target", type: DataTypes.STRING(150), allowNull: true },
    selectorCandidates: { field: "selector_candidates", type: DataTypes.JSON, allowNull: false },
    valueSample: { field: "value_sample", type: DataTypes.TEXT, allowNull: true },
    frameIndex: { field: "frame_index", type: DataTypes.INTEGER, allowNull: true }
  },
  {
    sequelize,
    tableName: "portal_observation_events",
    underscored: true,
    indexes: [
      { fields: ["session_id"], name: "portal_observation_events_session_id_idx" },
      { fields: ["session_id", "event_index"], name: "portal_observation_events_event_index_idx" }
    ]
  }
);

Quote.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    portalJobId: { field: "portal_job_id", type: DataTypes.STRING(32), allowNull: false },
    portalId: { field: "portal_id", type: DataTypes.STRING(32), allowNull: false },
    submissionId: { field: "submission_id", type: DataTypes.STRING(32), allowNull: false },
    premium: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false },
    quoteReference: { field: "quote_reference", type: DataTypes.STRING(255), allowNull: true },
    quotePayload: { field: "quote_payload", type: DataTypes.JSON, allowNull: false },
    memberId: { field: "member_id", type: DataTypes.STRING(32), allowNull: true },
    quotePdfUrl: { field: "quote_pdf_url", type: DataTypes.STRING(2048), allowNull: true },
    quotePdfPublicId: { field: "quote_pdf_public_id", type: DataTypes.STRING(255), allowNull: true },
    status: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "extracted" },
    extractedAt: { field: "extracted_at", type: DataTypes.DATE, allowNull: false }
  },
  {
    sequelize,
    tableName: "quotes",
    underscored: true,
    indexes: [
      { fields: ["portal_job_id"], name: "quotes_portal_job_id_idx" },
      { fields: ["portal_id"], name: "quotes_portal_id_idx" },
      { fields: ["submission_id"], name: "quotes_submission_id_idx" },
      { fields: ["extracted_at"], name: "quotes_extracted_at_idx" }
    ]
  }
);

export class Escalation extends Model {}
Escalation.init(
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    portalJobId: { field: "portal_job_id", type: DataTypes.STRING(32), allowNull: false },
    submissionId: { field: "submission_id", type: DataTypes.STRING(32), allowNull: false },
    agentActionId: { field: "agent_action_id", type: DataTypes.STRING(32), allowNull: true },
    escalationType: { field: "escalation_type", type: DataTypes.STRING(80), allowNull: true },
    portalId: { field: "portal_id", type: DataTypes.STRING(32), allowNull: true },
    newSnapshotId: { field: "new_snapshot_id", type: DataTypes.STRING(32), allowNull: true },
    draftMappingId: { field: "draft_mapping_id", type: DataTypes.STRING(32), allowNull: true },
    metadata: { type: DataTypes.JSON, allowNull: true },
    reason: { type: DataTypes.TEXT, allowNull: false },
    suggestedAction: { field: "suggested_action", type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "pending" },
    confidence: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    screenshotUrl: { field: "screenshot_url", type: DataTypes.STRING(2048), allowNull: true },
    resolutionPayload: { field: "resolution_payload", type: DataTypes.JSON, allowNull: true },
    resolvedBy: { field: "resolved_by", type: DataTypes.STRING(32), allowNull: true },
    resolvedAt: { field: "resolved_at", type: DataTypes.DATE, allowNull: true }
  },
  {
    sequelize,
    tableName: "escalations",
    underscored: true,
    indexes: [
      { fields: ["status"], name: "escalations_status_idx" },
      { fields: ["portal_job_id"], name: "escalations_portal_job_id_idx" },
      { fields: ["submission_id"], name: "escalations_submission_id_idx" },
      { fields: ["agent_action_id"], name: "escalations_agent_action_id_idx" },
      { fields: ["resolved_by"], name: "escalations_resolved_by_idx" },
      { fields: ["created_at"], name: "escalations_created_at_idx" }
    ]
  }
);

export class DailyStat extends Model {}
DailyStat.init(
  {
    statDate: { field: "stat_date", type: DataTypes.DATEONLY, primaryKey: true },
    submissionsCount: { field: "submissions_count", type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    completedCount: { field: "completed_count", type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    escalatedCount: { field: "escalated_count", type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    failedJobsCount: { field: "failed_jobs_count", type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    pendingEscalationsCount: { field: "pending_escalations_count", type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    averageCompletionMinutes: { field: "average_completion_minutes", type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    operatorStats: { field: "operator_stats", type: DataTypes.JSON, allowNull: false }
  },
  {
    sequelize,
    tableName: "daily_stats",
    underscored: true,
    indexes: [
      { fields: ["updated_at"], name: "daily_stats_updated_at_idx" }
    ]
  }
);

Portal.hasOne(PortalCredential, { foreignKey: "portalId" });
PortalCredential.belongsTo(Portal, { foreignKey: "portalId" });

User.hasMany(AuthSession, { foreignKey: "userId" });
AuthSession.belongsTo(User, { foreignKey: "userId" });

User.hasMany(Customer, { foreignKey: "createdBy" });
Customer.belongsTo(User, { foreignKey: "createdBy" });

Customer.hasMany(Submission, { foreignKey: "customerId" });
Submission.belongsTo(Customer, { foreignKey: "customerId" });
User.hasMany(Submission, { foreignKey: "createdBy" });
Submission.belongsTo(User, { foreignKey: "createdBy" });

Submission.hasMany(SubmissionDocument, { foreignKey: "submissionId" });
SubmissionDocument.belongsTo(Submission, { foreignKey: "submissionId" });
User.hasMany(SubmissionDocument, { foreignKey: "uploadedBy" });
SubmissionDocument.belongsTo(User, { foreignKey: "uploadedBy" });

Submission.hasOne(SubmissionData, { foreignKey: "submissionId" });
SubmissionData.belongsTo(Submission, { foreignKey: "submissionId" });
Customer.hasOne(CustomerData, { foreignKey: "customerId" });
CustomerData.belongsTo(Customer, { foreignKey: "customerId" });
Customer.hasMany(CustomerMember, { foreignKey: "customerId" });
CustomerMember.belongsTo(Customer, { foreignKey: "customerId" });
CustomerData.hasMany(CustomerMember, { foreignKey: "customerDataId" });
CustomerMember.belongsTo(CustomerData, { foreignKey: "customerDataId" });
CustomerMember.hasMany(MemberFieldValue, { foreignKey: "memberId" });
MemberFieldValue.belongsTo(CustomerMember, { foreignKey: "memberId" });
DynamicFieldDefinition.hasMany(MemberFieldValue, { foreignKey: "fieldId" });
MemberFieldValue.belongsTo(DynamicFieldDefinition, { foreignKey: "fieldId" });
Portal.hasMany(ExcelMappingTemplate, { foreignKey: "portalId" });
ExcelMappingTemplate.belongsTo(Portal, { foreignKey: "portalId" });
User.hasMany(ExcelMappingTemplate, { foreignKey: "createdBy" });
ExcelMappingTemplate.belongsTo(User, { foreignKey: "createdBy" });
Portal.hasMany(PortalFieldMapping, { foreignKey: "portalId" });
PortalFieldMapping.belongsTo(Portal, { foreignKey: "portalId" });
DomSnapshot.hasMany(PortalFieldMapping, { foreignKey: "domSnapshotId" });
PortalFieldMapping.belongsTo(DomSnapshot, { foreignKey: "domSnapshotId" });
User.hasMany(PortalFieldMapping, { foreignKey: "approvedBy" });
PortalFieldMapping.belongsTo(User, { foreignKey: "approvedBy" });
Portal.hasMany(PortalTemplate, { foreignKey: "portalId" });
PortalTemplate.belongsTo(Portal, { foreignKey: "portalId" });
User.hasMany(PortalTemplate, { foreignKey: "approvedBy" });
PortalTemplate.belongsTo(User, { foreignKey: "approvedBy" });
PortalTemplate.hasMany(CensusTemplate, { foreignKey: "portalTemplateId" });
CensusTemplate.belongsTo(PortalTemplate, { foreignKey: "portalTemplateId" });
Portal.hasMany(CensusTemplate, { foreignKey: "portalId" });
CensusTemplate.belongsTo(Portal, { foreignKey: "portalId" });
DomSnapshot.hasMany(CensusTemplate, { foreignKey: "domSnapshotId" });
CensusTemplate.belongsTo(DomSnapshot, { foreignKey: "domSnapshotId" });
User.hasMany(CensusTemplate, { foreignKey: "approvedBy" });
CensusTemplate.belongsTo(User, { foreignKey: "approvedBy" });
PortalTemplate.hasMany(PortalDialog, { foreignKey: "portalTemplateId" });
PortalDialog.belongsTo(PortalTemplate, { foreignKey: "portalTemplateId" });
Portal.hasMany(PortalDialog, { foreignKey: "portalId" });
PortalDialog.belongsTo(Portal, { foreignKey: "portalId" });
User.hasMany(PortalDialog, { foreignKey: "approvedBy" });
PortalDialog.belongsTo(User, { foreignKey: "approvedBy" });
Portal.hasMany(InsurerWorkflow, { foreignKey: "portalId" });
InsurerWorkflow.belongsTo(Portal, { foreignKey: "portalId" });
User.hasMany(CustomerIntakeLink, { foreignKey: "createdBy" });
CustomerIntakeLink.belongsTo(User, { foreignKey: "createdBy" });
IntakeFormTemplate.hasMany(CustomerIntakeLink, { foreignKey: "formTemplateId" });
CustomerIntakeLink.belongsTo(IntakeFormTemplate, { foreignKey: "formTemplateId" });
User.hasMany(IntakeFormTemplate, { foreignKey: "createdBy" });
IntakeFormTemplate.belongsTo(User, { foreignKey: "createdBy" });
Submission.hasMany(PublicIntakeLink, { foreignKey: "submissionId" });
PublicIntakeLink.belongsTo(Submission, { foreignKey: "submissionId" });
User.hasMany(PublicIntakeLink, { foreignKey: "createdBy" });
PublicIntakeLink.belongsTo(User, { foreignKey: "createdBy" });

Submission.hasMany(PortalJob, { foreignKey: "submissionId" });
PortalJob.belongsTo(Submission, { foreignKey: "submissionId" });
Portal.hasMany(PortalJob, { foreignKey: "portalId" });
PortalJob.belongsTo(Portal, { foreignKey: "portalId" });
PortalTemplate.hasMany(PortalJob, { foreignKey: "portalTemplateId" });
PortalJob.belongsTo(PortalTemplate, { foreignKey: "portalTemplateId" });
CensusTemplate.hasMany(PortalJob, { foreignKey: "censusTemplateId" });
PortalJob.belongsTo(CensusTemplate, { foreignKey: "censusTemplateId" });

PortalJob.hasMany(AgentAction, { foreignKey: "portalJobId" });
AgentAction.belongsTo(PortalJob, { foreignKey: "portalJobId" });
CustomerMember.hasMany(PortalJob, { foreignKey: "memberId" });
PortalJob.belongsTo(CustomerMember, { foreignKey: "memberId" });

Portal.hasMany(DomSnapshot, { foreignKey: "portalId" });
DomSnapshot.belongsTo(Portal, { foreignKey: "portalId" });
PortalJob.hasMany(DomSnapshot, { foreignKey: "portalJobId" });
DomSnapshot.belongsTo(PortalJob, { foreignKey: "portalJobId" });
Portal.hasMany(PortalObservationSession, { foreignKey: "portalId" });
PortalObservationSession.belongsTo(Portal, { foreignKey: "portalId" });
PortalObservationSession.hasMany(PortalObservationEvent, { foreignKey: "sessionId" });
PortalObservationEvent.belongsTo(PortalObservationSession, { foreignKey: "sessionId" });
PortalFieldMapping.hasMany(PortalObservationSession, { foreignKey: "draftMappingId" });
PortalObservationSession.belongsTo(PortalFieldMapping, { foreignKey: "draftMappingId" });

PortalJob.hasMany(Quote, { foreignKey: "portalJobId" });
Quote.belongsTo(PortalJob, { foreignKey: "portalJobId" });
Portal.hasMany(Quote, { foreignKey: "portalId" });
Quote.belongsTo(Portal, { foreignKey: "portalId" });
Submission.hasMany(Quote, { foreignKey: "submissionId" });
Quote.belongsTo(Submission, { foreignKey: "submissionId" });
CustomerMember.hasMany(Quote, { foreignKey: "memberId" });
Quote.belongsTo(CustomerMember, { foreignKey: "memberId" });

PortalJob.hasMany(Escalation, { foreignKey: "portalJobId" });
Escalation.belongsTo(PortalJob, { foreignKey: "portalJobId" });
Submission.hasMany(Escalation, { foreignKey: "submissionId" });
Escalation.belongsTo(Submission, { foreignKey: "submissionId" });
AgentAction.hasMany(Escalation, { foreignKey: "agentActionId" });
Escalation.belongsTo(AgentAction, { foreignKey: "agentActionId" });
User.hasMany(Escalation, { foreignKey: "resolvedBy" });
Escalation.belongsTo(User, { foreignKey: "resolvedBy" });
