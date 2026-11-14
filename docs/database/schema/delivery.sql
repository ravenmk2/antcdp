-- 仓库关联与标签结构阅读副本；实际安装与升级执行嵌入式 Goose 迁移。
-- 仅用于结构评审或隔离空库验证，不导入现有安装。
-- 不含种子或升级数据修正；通用约定见 ../README.md。

-- 仓库关联

CREATE TABLE `project_repository` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id BIGINT UNSIGNED NOT NULL,
    connection_id BIGINT UNSIGNED NOT NULL,
    repo_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    name VARCHAR(255) NOT NULL,
    namespace_path VARCHAR(2048) NOT NULL DEFAULT '',
    full_path VARCHAR(2048) NOT NULL,
    web_url VARCHAR(2048) NULL,
    http_clone_url VARCHAR(2048) NULL,
    ssh_clone_url VARCHAR(2048) NULL,
    default_branch VARCHAR(1024) NULL,
    remote_archived BOOLEAN NULL,
    last_synced_at DATETIME(3) NOT NULL,
    last_sync_check JSON NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_project_repository_target (project_id, connection_id, repo_id),
    KEY idx_project_repository_project (project_id, id),
    KEY idx_project_repository_project_connection (project_id, connection_id, id),
    KEY idx_project_repository_connection (connection_id, id),
    KEY idx_project_repository_creator (created_by_user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_repository_label (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id BIGINT UNSIGNED NOT NULL,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) NOT NULL,
    color CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_project_repository_label_code (project_id, code)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_repository_label_binding (
    project_repository_id BIGINT UNSIGNED NOT NULL,
    label_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (project_repository_id, label_id),
    KEY idx_repository_label_binding_label (label_id, project_repository_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
