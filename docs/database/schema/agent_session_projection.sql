-- Reading copy of 00013_agent_runtime.sql; execute embedded migrations instead.

CREATE TABLE `agent_session_projection` (
  `session_id` BIGINT UNSIGNED NOT NULL,
  `projection_version` INT UNSIGNED NOT NULL,
  `through_seq` BIGINT UNSIGNED NOT NULL,
  `payload` JSON NOT NULL,
  `payload_sha256` BINARY(32) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
