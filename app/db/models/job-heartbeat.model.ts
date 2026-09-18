import { DataTypes, Model, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "~/db/sequelize";

export type JobHeartbeatResult = "ok" | "error";

// job_heartbeat — dead-man's-switch table for the serverless cron tick
// (ADR-0009 D6, data-model.md new §4.7). ONE row per named job
// (currently just "cron_tick"). DELIBERATELY has NO shop_id column and NO
// FK to `shop` — same class of documented non-tenant exception as
// compliance_audit_log (data-model.md §5): this is a global operational
// table, not tenant data, and must be excluded from FT-02c's "every table
// has a shop_id" enumeration and FT-08's redaction table-enumeration sweep
// for the identical structural reason compliance_audit_log is excluded.
//
// /healthz reads this (via the repository, never directly) to compute the
// `cronStale` boolean — see app/routes/healthz.tsx and
// app/db/repositories/job-heartbeat.repository.ts.
export class JobHeartbeatModel extends Model<
  InferAttributes<JobHeartbeatModel>,
  InferCreationAttributes<JobHeartbeatModel>
> {
  declare jobName: string;
  declare lastRunAt: Date;
  declare lastResult: JobHeartbeatResult;
  declare lastError: string | null;
}

JobHeartbeatModel.init(
  {
    jobName: { type: DataTypes.TEXT, primaryKey: true, field: "job_name" },
    lastRunAt: { type: DataTypes.DATE, allowNull: false, field: "last_run_at" },
    lastResult: { type: DataTypes.TEXT, allowNull: false, field: "last_result" },
    lastError: { type: DataTypes.TEXT, allowNull: true, field: "last_error" },
  },
  {
    sequelize,
    modelName: "JobHeartbeat",
    tableName: "job_heartbeat",
    underscored: true,
    timestamps: false,
  },
);
