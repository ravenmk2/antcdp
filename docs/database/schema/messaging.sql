-- 邮件、短信与钉钉结构阅读副本；实际安装与升级执行嵌入式 Goose 迁移。
-- 仅用于结构评审或隔离空库验证，不导入现有安装。
-- 不含种子或升级数据修正；通用约定见 ../README.md。

-- 邮件

CREATE TABLE email_profile (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSON NOT NULL,
    config_schema_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    secret_ciphertext TEXT NULL,
    secret_format_version BIGINT UNSIGNED NULL,
    secret_key_version VARCHAR(16) NULL,
    PRIMARY KEY(id), UNIQUE KEY uq_email_profile_code(code), UNIQUE KEY uq_email_profile_name(name)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE email_sender_name (
    id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    profile_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(100) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY(id), UNIQUE KEY uq_email_sender_name(profile_id,name), KEY idx_email_sender_profile(profile_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE email_template (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSON NOT NULL,
    config_schema_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY(id), UNIQUE KEY uq_email_template_code(code), UNIQUE KEY uq_email_template_name(name)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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

-- 短信

CREATE TABLE sms_profile (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSON NOT NULL,
    config_schema_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    secret_ciphertext TEXT NULL,
    secret_format_version BIGINT UNSIGNED NULL,
    secret_key_version VARCHAR(16) NULL,
    PRIMARY KEY(id), UNIQUE KEY uq_sms_profile_code(code), UNIQUE KEY uq_sms_profile_name(name)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sms_template (
    profile_id BIGINT UNSIGNED NULL,
    KEY idx_sms_template_profile(profile_id),
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSON NOT NULL,
    config_schema_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY(id), UNIQUE KEY uq_sms_template_code(code), UNIQUE KEY uq_sms_template_name(name)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sms_send_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    test_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    profile_id BIGINT UNSIGNED NOT NULL,
    template_id BIGINT UNSIGNED NULL,
    actor_user_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(32) NOT NULL,
    snapshot JSON NOT NULL,
    started_at DATETIME(3) NOT NULL,
    finished_at DATETIME(3) NULL,
    PRIMARY KEY(id), UNIQUE KEY uq_sms_test(test_id),
    KEY idx_sms_log_started(started_at,id),
    KEY idx_sms_log_profile(profile_id,started_at,id),
    KEY idx_sms_log_template(template_id,started_at,id),
    KEY idx_sms_log_actor(actor_user_id,started_at,id),
    KEY idx_sms_log_status(status,started_at,id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 钉钉

CREATE TABLE dingtalk_robot (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSON NOT NULL,
    config_schema_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    last_test JSON NULL,
    secret_ciphertext TEXT NULL,
    secret_format_version BIGINT UNSIGNED NULL,
    secret_key_version VARCHAR(16) NULL,
    PRIMARY KEY(id), UNIQUE KEY uq_dingtalk_robot_code(code), UNIQUE KEY uq_dingtalk_robot_name(name)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
