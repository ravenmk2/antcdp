-- Reading copy of 00013_agent_runtime.sql; execute embedded migrations instead.

CREATE TABLE `agent_resource_reference` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    holder_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    holder_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    resource_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    resource_id BIGINT UNSIGNED NOT NULL,
    state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    executor_epoch VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    fence_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    last_verified_at DATETIME(3) NULL,
    released_at DATETIME(3) NULL,
    release_reason VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    release_evidence JSON NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_agent_resource_reference (holder_kind, holder_id, resource_kind, resource_id),
    KEY idx_agent_resource_reference_live (resource_kind, resource_id, state, id),
    KEY idx_agent_resource_reference_reconcile (state, executor_epoch, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
