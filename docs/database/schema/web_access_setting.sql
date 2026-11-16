-- Reading copy of 00008_web_access.sql; execute embedded migrations instead.

CREATE TABLE `web_access_setting` (
    id TINYINT UNSIGNED NOT NULL,
    search_routes JSON NOT NULL,
    search_max_results SMALLINT UNSIGNED NOT NULL,
    fetch_routes JSON NOT NULL,
    fetch_max_bytes INT UNSIGNED NOT NULL,
    fetch_timeout_seconds INT UNSIGNED NOT NULL,
    fetch_max_redirects TINYINT UNSIGNED NOT NULL,
    fetch_allowed_internal_hosts JSON NOT NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
