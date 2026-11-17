-- Reading copy of 00011_events.sql; execute embedded migrations instead.

CREATE TABLE `event_consumption_log` (
 consumption_id BIGINT UNSIGNED NOT NULL,
 seq BIGINT UNSIGNED NOT NULL,
 attempt_no INT UNSIGNED NOT NULL,
 occurred_at DATETIME(3) NOT NULL,
 kind VARCHAR(24) NOT NULL,
 level VARCHAR(16) NOT NULL,
 message TEXT NOT NULL,
 fields JSON NOT NULL,
 PRIMARY KEY(consumption_id,seq),
 KEY idx_event_consumption_attempt(consumption_id,attempt_no,seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
