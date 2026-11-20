-- Reading copy of 00012_agent_definitions.sql; execute embedded migrations instead.

CREATE TABLE `agent_model_binding` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    agent_id BIGINT UNSIGNED NOT NULL,
    model_definition_id BIGINT UNSIGNED NOT NULL,
    thinking_options JSON NOT NULL,
    default_thinking VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    generation_parameters JSON NOT NULL,
    sort_order INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    removed_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_agent_model_binding (agent_id, model_definition_id),
    KEY idx_agent_model_target (model_definition_id, agent_id),
    KEY idx_agent_model_binding_current (agent_id, removed_at, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
