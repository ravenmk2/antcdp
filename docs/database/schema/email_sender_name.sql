-- Reading copy of 00006_messaging.sql; execute embedded migrations instead.

CREATE TABLE email_sender_name (
    id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    profile_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(100) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY(id), UNIQUE KEY uq_email_sender_name(profile_id,name), KEY idx_email_sender_profile(profile_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
