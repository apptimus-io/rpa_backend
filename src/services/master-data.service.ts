import { CoverageType } from "../db/models.js";
import { canFallbackFromDatabaseError, shouldUseDatabase } from "../db/runtime.js";

export type CoverageTypeRecord = {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  config?: Record<string, unknown> | null;
  isActive: boolean;
  sortOrder: number;
};

const fallbackCoverageTypes: CoverageTypeRecord[] = [
  { id: "cov_motor_fleet", name: "Motor Fleet", code: "motor_fleet", description: "Fleet motor insurance customer census and vehicle/risk submission.", config: null, isActive: true, sortOrder: 10 },
  { id: "cov_commercial_property", name: "Commercial Property", code: "commercial_property", description: "Commercial property quote and risk submission.", config: null, isActive: true, sortOrder: 20 },
  { id: "cov_medical", name: "Medical", code: "medical", description: "Medical or health insurance census submission.", config: { templateEnabled: true }, isActive: true, sortOrder: 30 },
  { id: "cov_personal_auto", name: "Personal Auto", code: "personal_auto", description: "Individual motor insurance submission.", config: null, isActive: true, sortOrder: 40 }
];

function fromModel(row: Record<string, unknown>): CoverageTypeRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    code: String(row.code ?? String(row.name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")),
    description: row.description ? String(row.description) : null,
    config: row.config as Record<string, unknown> | null ?? null,
    isActive: Boolean(row.isActive),
    sortOrder: Number(row.sortOrder ?? 0)
  };
}

export async function listCoverageTypes() {
  if (shouldUseDatabase()) {
    try {
      const rows = await CoverageType.findAll({ where: { isActive: true }, order: [["sortOrder", "ASC"], ["name", "ASC"]], raw: true });
      return rows.map((row) => fromModel(row as unknown as Record<string, unknown>));
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }
  return fallbackCoverageTypes;
}

export async function isValidCoverageType(name: string) {
  const coverageTypes = await listCoverageTypes();
  return coverageTypes.some((item) => item.name === name);
}
