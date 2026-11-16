-- Reading copy of 00006_messaging.sql; execute embedded migrations instead.

CREATE TABLE email_send_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    test_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    profile_id BIGINT UNSIGNED NOT NULL,
    template_id BIGINT UNSIGNED NULL,
    actor_user_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(32) NOT NULL,
    snapshot JSON NOT NULL,
    started_at DATETIME(3) NOT NULL,
    finished_at DATETIME(3) NULL,
    PRIMARY KEY(id), UNIQUE KEY uq_email_test(test_id),
    KEY idx_email_log_started(started_at,id),
    KEY idx_email_log_profile(profile_id,started_at,id),
    KEY idx_email_log_template(template_id,started_at,id),
    KEY idx_email_log_actor(actor_user_id,started_at,id),
    KEY idx_email_log_status(status,started_at,id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
