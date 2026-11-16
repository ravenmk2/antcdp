-- Reading copy of 00001_platform.sql; execute embedded migrations instead.

CREATE TABLE `session` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash BINARY(32) NOT NULL,
    auth_version BIGINT UNSIGNED NOT NULL,
    ttl_days SMALLINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    last_seen_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    revoked_at DATETIME(3) NULL,
    ip_address VARCHAR(45) CHARACTER SET ascii COLLATE ascii_bin NULL,
    user_agent VARCHAR(512) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_session_token_hash (token_hash),
    KEY idx_session_user_validity (user_id, revoked_at, expires_at),
    KEY idx_session_expiry (expires_at, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
