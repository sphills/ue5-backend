-- Core schema. All times are UTC (DATETIME(3), millisecond precision).

CREATE TABLE accounts (
  id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  username            VARCHAR(24)      NOT NULL,
  username_key        VARCHAR(24)      NOT NULL,             -- lower-cased, for case-insensitive uniqueness
  email               VARCHAR(254)     NULL,
  password_hash       VARCHAR(255)     NOT NULL,
  status              ENUM('active','banned') NOT NULL DEFAULT 'active',
  credits             BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  stash_slots         SMALLINT UNSIGNED NOT NULL DEFAULT 48,
  inventory_revision  INT UNSIGNED     NOT NULL DEFAULT 0,   -- bumped on every inventory/credits change
  active_match_id     VARCHAR(64)      NULL,                 -- set by a dedicated server; locks the loadout
  match_started_at    DATETIME(3)      NULL,
  last_match_id       VARCHAR(64)      NULL,                 -- makes "end match" idempotent
  created_at          DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_accounts_username_key (username_key),
  UNIQUE KEY uq_accounts_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sessions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id    BIGINT UNSIGNED NOT NULL,
  token_hash    BINARY(32)      NOT NULL,                    -- SHA-256 of the bearer token
  client_type   ENUM('game','web') NOT NULL,
  ip            VARCHAR(45)     NULL,
  user_agent    VARCHAR(255)    NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at    DATETIME(3)     NOT NULL,
  revoked_at    DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token_hash (token_hash),
  KEY ix_sessions_account (account_id, revoked_at, expires_at),
  KEY ix_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE item_definitions (
  id               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  code             VARCHAR(64)      NOT NULL,                -- stable key shared with the UE5 project
  name             VARCHAR(100)     NOT NULL,
  description      VARCHAR(500)     NOT NULL DEFAULT '',
  category         ENUM('weapon','armor','ammo','consumable','material','quest','cosmetic') NOT NULL,
  rarity           ENUM('common','uncommon','rare','epic','legendary') NOT NULL DEFAULT 'common',
  max_stack        SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  sell_price       INT UNSIGNED     NOT NULL DEFAULT 0,
  is_sellable      TINYINT(1)       NOT NULL DEFAULT 1,
  is_discardable   TINYINT(1)       NOT NULL DEFAULT 1,
  loadout_allowed  TINYINT(1)       NOT NULL DEFAULT 1,
  asset_path       VARCHAR(255)     NULL,                    -- UE5 soft object path of the item's data asset
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_definitions_code (code),
  CONSTRAINT ck_item_definitions_stack CHECK (max_stack >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inventory_items (
  id            BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  account_id    BIGINT UNSIGNED  NOT NULL,
  item_def_id   INT UNSIGNED     NOT NULL,
  container     ENUM('stash','loadout') NOT NULL,
  slot          SMALLINT UNSIGNED NOT NULL,
  quantity      INT UNSIGNED     NOT NULL,
  acquired_at   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory_items_slot (account_id, container, slot),
  KEY ix_inventory_items_def (item_def_id),
  CONSTRAINT fk_inventory_items_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
  CONSTRAINT fk_inventory_items_def FOREIGN KEY (item_def_id) REFERENCES item_definitions (id),
  CONSTRAINT ck_inventory_items_quantity CHECK (quantity >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Append-only audit trail of every inventory and credit change (support tickets, exploit hunting).
CREATE TABLE inventory_events (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id     BIGINT UNSIGNED NOT NULL,
  action         VARCHAR(32)     NOT NULL,
  item_def_id    INT UNSIGNED    NULL,
  quantity       INT             NOT NULL DEFAULT 0,
  credits_delta  BIGINT          NOT NULL DEFAULT 0,
  actor          ENUM('player','server','system') NOT NULL,
  session_id     BIGINT UNSIGNED NULL,
  reason         VARCHAR(128)    NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_inventory_events_account (account_id, created_at),
  CONSTRAINT fk_inventory_events_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
