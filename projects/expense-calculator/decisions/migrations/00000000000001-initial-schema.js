'use strict';

/**
 * ============================================================================
 * DRAFT / UNAPPLIED — G-Schema review artifact. DO NOT RUN.
 * ============================================================================
 *
 * This migration has NOT been applied to any database, throwaway or otherwise.
 * It is the schema-design deliverable for the open G-Schema gate
 * (project.json v7, gate id "G-Schema"). Per the hard rule stated in that
 * gate's notes: "no migration runs before G-Schema is approved."
 *
 * When the app is scaffolded at G3, this file (or its reviewed/amended
 * content) should be copied into the real `db/migrations/` directory with a
 * proper timestamp-based filename per the Sequelize CLI convention. The
 * `00000000000001` prefix here is a placeholder ordering marker only, not a
 * real Sequelize-CLI-generated timestamp.
 *
 * Companion doc: decisions/data-model.md — every constraint below is
 * explained and tied back to a numbered constraint from the architect's
 * G-Schema handoff (architecture-packet.md §8) or to a spec.md deliverable.
 *
 * Style note: this migration is written mostly as raw SQL via
 * `queryInterface.sequelize.query(...)`, rather than queryInterface's table-
 * builder DSL. That's a deliberate choice, not a shortcut: this schema leans
 * heavily on multi-column CHECK constraints, partial indexes, deferred
 * constraint triggers, and a couple of small PL/pgSQL functions — none of
 * which the Sequelize DSL expresses cleanly. Raw SQL keeps the DDL reviewable
 * as SQL, which is the format a human Tech lead will actually want to read at
 * this gate.
 *
 * Reversibility: `down` drops everything `up` creates, in reverse dependency
 * order. The `pgcrypto` extension is deliberately NOT dropped in `down` —
 * other schemas/extensions on a shared database instance may depend on it;
 * dropping an extension is an operational decision, not something this app's
 * migration should own.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface /*, Sequelize */) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql) => queryInterface.sequelize.query(sql, { transaction });

      // ----------------------------------------------------------------------
      // Extension prerequisite (verify-at-build: hosting provider must permit
      // CREATE EXTENSION; see data-model.md §10)
      // ----------------------------------------------------------------------
      await q(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

      // ----------------------------------------------------------------------
      // shop — tenant root. See data-model.md §4.1.
      // ----------------------------------------------------------------------
      await q(`
        CREATE TABLE shop (
          id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          shop_domain    TEXT NOT NULL,
          installed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          uninstalled_at TIMESTAMPTZ NULL,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT uq_shop_domain UNIQUE (shop_domain)
        );
      `);
      await q(`
        CREATE INDEX idx_shop_uninstalled_at
          ON shop (uninstalled_at)
          WHERE uninstalled_at IS NOT NULL;
      `);

      // ----------------------------------------------------------------------
      // expense_rule — per-shop configured rule per fixed category.
      // See data-model.md §4.2. category_key CHECK list mirrors the
      // EXPENSE_CATEGORIES code constant (data-model.md §2) — keep in sync.
      // ----------------------------------------------------------------------
      await q(`
        CREATE TABLE expense_rule (
          id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          shop_id             UUID NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
          category_key        TEXT NOT NULL,
          rule_type           TEXT NOT NULL,
          rate_basis_points   INTEGER NULL,
          fixed_amount_minor  BIGINT NULL,
          formula_key         TEXT NULL,
          enabled             BOOLEAN NOT NULL DEFAULT true,
          created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT uq_expense_rule_shop_category UNIQUE (shop_id, category_key),
          CONSTRAINT chk_expense_rule_category_key CHECK (category_key IN (
            'cost_of_goods', 'marketing', 'platform_fees', 'payment_processing',
            'shipping', 'apps_software', 'payroll', 'overhead', 'taxes', 'misc'
          )),
          CONSTRAINT chk_expense_rule_rule_type CHECK (
            rule_type IN ('percentage', 'fixed', 'formula')
          ),
          CONSTRAINT chk_expense_rule_rate_bp_nonneg CHECK (
            rate_basis_points IS NULL OR rate_basis_points >= 0
          ),
          CONSTRAINT chk_expense_rule_fixed_nonneg CHECK (
            fixed_amount_minor IS NULL OR fixed_amount_minor >= 0
          ),
          CONSTRAINT chk_expense_rule_value_shape CHECK (
            (rule_type = 'percentage' AND rate_basis_points IS NOT NULL
              AND fixed_amount_minor IS NULL AND formula_key IS NULL)
            OR (rule_type = 'fixed' AND fixed_amount_minor IS NOT NULL
              AND rate_basis_points IS NULL AND formula_key IS NULL)
            OR (rule_type = 'formula' AND formula_key IS NOT NULL
              AND rate_basis_points IS NULL AND fixed_amount_minor IS NULL)
          )
        );
      `);
      await q(`CREATE INDEX idx_expense_rule_shop_id ON expense_rule (shop_id);`);

      // ----------------------------------------------------------------------
      // calculation — a saved, append-only calculation. See data-model.md §4.3.
      // ----------------------------------------------------------------------
      await q(`
        CREATE TABLE calculation (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          shop_id               UUID NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
          revenue_minor         BIGINT NOT NULL,
          currency_code         TEXT NOT NULL,
          total_expenses_minor  BIGINT NOT NULL,
          net_amount_minor      BIGINT NOT NULL,
          engine_version        TEXT NOT NULL,
          created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT chk_calculation_revenue_nonneg CHECK (revenue_minor >= 0),
          CONSTRAINT chk_calculation_total_nonneg CHECK (total_expenses_minor >= 0),
          CONSTRAINT chk_calculation_currency_format CHECK (currency_code ~ '^[A-Z]{3}$')
        );
      `);
      await q(`CREATE INDEX idx_calculation_shop_id ON calculation (shop_id);`);
      await q(`
        CREATE INDEX idx_calculation_shop_created
          ON calculation (shop_id, created_at DESC);
      `);

      // ----------------------------------------------------------------------
      // calculation_line_item — per-category result + snapshotted rule.
      // NO FK to expense_rule (constraint #1). See data-model.md §4.4.
      // ----------------------------------------------------------------------
      await q(`
        CREATE TABLE calculation_line_item (
          id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          calculation_id              UUID NOT NULL REFERENCES calculation(id) ON DELETE CASCADE,
          shop_id                     UUID NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
          category_key                TEXT NOT NULL,
          category_label_at_save      TEXT NOT NULL,
          rule_type_at_save           TEXT NOT NULL,
          rate_basis_points_at_save   INTEGER NULL,
          fixed_amount_minor_at_save  BIGINT NULL,
          formula_key_at_save         TEXT NULL,
          rule_snapshot               JSONB NOT NULL,
          computed_amount_minor       BIGINT NOT NULL,
          sort_order                  SMALLINT NOT NULL,
          created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT uq_calc_line_item_calc_category UNIQUE (calculation_id, category_key),
          CONSTRAINT chk_cli_category_key CHECK (category_key IN (
            'cost_of_goods', 'marketing', 'platform_fees', 'payment_processing',
            'shipping', 'apps_software', 'payroll', 'overhead', 'taxes', 'misc'
          )),
          CONSTRAINT chk_cli_rule_type CHECK (
            rule_type_at_save IN ('percentage', 'fixed', 'formula')
          ),
          CONSTRAINT chk_cli_amount_nonneg CHECK (computed_amount_minor >= 0)
        );
      `);
      await q(`CREATE INDEX idx_cli_shop_id ON calculation_line_item (shop_id);`);
      await q(`CREATE INDEX idx_cli_calculation_id ON calculation_line_item (calculation_id);`);

      // ----------------------------------------------------------------------
      // webhook_event — durable inbox (ADR-0002). See data-model.md §4.5.
      // ----------------------------------------------------------------------
      await q(`
        CREATE TABLE webhook_event (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          webhook_id    TEXT NOT NULL,
          shop_id       UUID NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
          shop_domain   TEXT NOT NULL,
          topic         TEXT NOT NULL,
          payload       JSONB NOT NULL,
          received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          processed_at  TIMESTAMPTZ NULL,
          attempts      INTEGER NOT NULL DEFAULT 0,
          last_error    TEXT NULL,
          CONSTRAINT uq_webhook_event_webhook_id UNIQUE (webhook_id),
          CONSTRAINT chk_webhook_event_topic CHECK (topic IN (
            'customers/data_request', 'customers/redact', 'shop/redact', 'app/uninstalled'
          ))
        );
      `);
      await q(`CREATE INDEX idx_webhook_event_shop_id ON webhook_event (shop_id);`);
      await q(`
        CREATE INDEX idx_webhook_event_unprocessed
          ON webhook_event (received_at)
          WHERE processed_at IS NULL;
      `);

      // ----------------------------------------------------------------------
      // compliance_audit_log — deliberately NOT shop_id-keyed. Must survive
      // shop deletion. See data-model.md §5.
      // ----------------------------------------------------------------------
      await q(`
        CREATE TABLE compliance_audit_log (
          id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          shop_domain          TEXT NOT NULL,
          webhook_id           TEXT NOT NULL,
          topic                TEXT NOT NULL,
          outcome              TEXT NOT NULL,
          reason               TEXT NULL,
          deleted_row_counts   JSONB NULL,
          occurred_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT uq_compliance_audit_webhook_topic UNIQUE (webhook_id, topic),
          CONSTRAINT chk_compliance_audit_topic CHECK (topic IN (
            'customers/data_request', 'customers/redact', 'shop/redact'
          )),
          CONSTRAINT chk_compliance_audit_outcome CHECK (outcome IN ('completed', 'no_op'))
        );
      `);
      await q(`
        CREATE INDEX idx_compliance_audit_shop_domain
          ON compliance_audit_log (shop_domain);
      `);

      // ----------------------------------------------------------------------
      // Append-only enforcement (constraint #6 / FT-14c). See data-model.md §6.
      // BEFORE UPDATE only — DELETE stays legal for the redaction cascade.
      // ----------------------------------------------------------------------
      await q(`
        CREATE OR REPLACE FUNCTION prevent_row_mutation() RETURNS trigger AS $BODY$
        BEGIN
          RAISE EXCEPTION 'Table % is append-only; UPDATE is not permitted (id=%)',
            TG_TABLE_NAME, OLD.id;
        END;
        $BODY$ LANGUAGE plpgsql;
      `);
      await q(`
        CREATE TRIGGER trg_calculation_no_update
          BEFORE UPDATE ON calculation
          FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();
      `);
      await q(`
        CREATE TRIGGER trg_calculation_line_item_no_update
          BEFORE UPDATE ON calculation_line_item
          FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();
      `);

      // ----------------------------------------------------------------------
      // Reconciliation defense-in-depth (ADR-0005 item 4). See data-model.md §4.4.
      // Deferred to end-of-transaction so calculation + all its line items can
      // be inserted in any order within one transaction.
      // ----------------------------------------------------------------------
      await q(`
        CREATE OR REPLACE FUNCTION assert_calculation_line_items_reconcile()
        RETURNS trigger AS $BODY$
        DECLARE
          v_calculation_id UUID;
          v_expected BIGINT;
          v_actual BIGINT;
        BEGIN
          v_calculation_id := COALESCE(NEW.calculation_id, OLD.calculation_id);

          SELECT total_expenses_minor INTO v_expected
            FROM calculation WHERE id = v_calculation_id;

          IF v_expected IS NULL THEN
            -- Parent calculation row itself is gone (e.g. mid-redaction cascade) —
            -- nothing to reconcile against.
            RETURN NULL;
          END IF;

          SELECT COALESCE(SUM(computed_amount_minor), 0) INTO v_actual
            FROM calculation_line_item WHERE calculation_id = v_calculation_id;

          IF v_expected <> v_actual THEN
            RAISE EXCEPTION
              'calculation % line items (sum=%) do not reconcile with total_expenses_minor (%)',
              v_calculation_id, v_actual, v_expected;
          END IF;

          RETURN NULL;
        END;
        $BODY$ LANGUAGE plpgsql;
      `);
      await q(`
        CREATE CONSTRAINT TRIGGER trg_cli_reconciles
          AFTER INSERT OR DELETE ON calculation_line_item
          DEFERRABLE INITIALLY DEFERRED
          FOR EACH ROW EXECUTE FUNCTION assert_calculation_line_items_reconcile();
      `);
    });
  },

  async down(queryInterface /*, Sequelize */) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql) => queryInterface.sequelize.query(sql, { transaction });

      await q(`DROP TRIGGER IF EXISTS trg_cli_reconciles ON calculation_line_item;`);
      await q(`DROP FUNCTION IF EXISTS assert_calculation_line_items_reconcile();`);

      await q(`DROP TRIGGER IF EXISTS trg_calculation_line_item_no_update ON calculation_line_item;`);
      await q(`DROP TRIGGER IF EXISTS trg_calculation_no_update ON calculation;`);
      await q(`DROP FUNCTION IF EXISTS prevent_row_mutation();`);

      // Drop in reverse dependency order. CASCADE FKs would let a plain
      // `DROP TABLE shop CASCADE` do this in one line, but explicit ordering
      // here documents the real dependency graph rather than relying on it.
      await q(`DROP TABLE IF EXISTS compliance_audit_log;`);
      await q(`DROP TABLE IF EXISTS webhook_event;`);
      await q(`DROP TABLE IF EXISTS calculation_line_item;`);
      await q(`DROP TABLE IF EXISTS calculation;`);
      await q(`DROP TABLE IF EXISTS expense_rule;`);
      await q(`DROP TABLE IF EXISTS shop;`);

      // Deliberately NOT dropping the pgcrypto extension — see file header.
    });
  },
};
