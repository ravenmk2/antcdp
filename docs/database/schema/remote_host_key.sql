-- Reading copy of 00005_remote_hosts.sql; execute embedded migrations instead.

CREATE TABLE remote_host_key (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 host_id BIGINT UNSIGNED NOT NULL,
 algorithm VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 public_key TEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 fingerprint_sha256 VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 trusted_by_user_id BIGINT UNSIGNED NULL,
 trusted_at DATETIME(3) NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uq_remote_host_key_fingerprint(host_id,fingerprint_sha256)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
