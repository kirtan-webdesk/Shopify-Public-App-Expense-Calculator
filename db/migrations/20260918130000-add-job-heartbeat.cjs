'use strict';

/**
 * ============================================================================
 * Add job_heartbeat — ADR-0009 D6 / G-Schema delta (G1.5-revision)
 * ============================================================================
 *
 * Small, additive migration. No existing table is touched. Companion to
 * decisions/ADR-0009-serverless-webhook-processing.md §D6/§7 and
 * decisions/data-model.md §4.7 (new section, this round).
 *
 * job_heartbeat is the dead-man's-switch for the serverless cron tick
 * (/api/cron/tick — app/routes/api.cron.tick.tsx): one row per named job
 * ("cron_tick" today), overwritten on every tick with the most recent
 * run's outcome. /healthz derives a `cronStale` boolean from it.
 *
 * DELIBERATELY NO shop_id column, NO FK to shop — this is a global
 * operational table, not tenant data, the same documented class of
 * exception as compliance_audit_log (data-model.md §5). It must be added to
 * the non-tenant exemption lists in fitness-test-plan.md's FT-02c and FT-08
 * (done in this same commit) so neither check wrongly flags it.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface /*, Sequelize */) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql) => queryInterface.sequelize.query(sql, { transaction });

      await q(`
        CREATE TABLE job_heartbeat (
          job_name     TEXT PRIMARY KEY,
          last_run_at  TIMESTAMPTZ NOT NULL,
          last_result  TEXT NOT NULL,
          last_error   TEXT NULL,
          CONSTRAINT chk_job_heartbeat_result CHECK (last_result IN ('ok', 'error'))
        );
      `);
    });
  },

  async down(queryInterface /*, Sequelize */) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
      await q(`DROP TABLE IF EXISTS job_heartbeat;`);
    });
  },
};
