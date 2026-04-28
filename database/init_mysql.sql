CREATE DATABASE IF NOT EXISTS `test_platform`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE `test_platform`;

CREATE TABLE IF NOT EXISTS `sys_role` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_code` VARCHAR(64) NOT NULL,
  `role_name` VARCHAR(100) NOT NULL,
  `description` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sys_role_code` (`role_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sys_user` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(64) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(100) NULL,
  `email` VARCHAR(255) NULL,
  `phone` VARCHAR(50) NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '0 disabled, 1 enabled',
  `last_login_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sys_user_username` (`username`),
  KEY `idx_sys_user_role_id` (`role_id`),
  CONSTRAINT `fk_sys_user_role` FOREIGN KEY (`role_id`) REFERENCES `sys_role` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sys_operation_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NULL,
  `project_id` BIGINT UNSIGNED NULL,
  `action` VARCHAR(100) NOT NULL,
  `resource_type` VARCHAR(100) NULL,
  `resource_id` BIGINT UNSIGNED NULL,
  `ip_address` VARCHAR(64) NULL,
  `user_agent` VARCHAR(500) NULL,
  `detail_json` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_sys_operation_log_user_time` (`user_id`, `created_at`),
  KEY `idx_sys_operation_log_project_time` (`project_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_project` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_code` VARCHAR(64) NOT NULL,
  `project_name` VARCHAR(200) NOT NULL,
  `description` VARCHAR(1000) NULL,
  `owner_id` BIGINT UNSIGNED NULL,
  `status` TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tp_project_code` (`project_code`),
  KEY `idx_tp_project_owner` (`owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_project_member` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `project_role` VARCHAR(64) NOT NULL DEFAULT 'tester' COMMENT 'project_admin/test_lead/tester/viewer',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT 'active/disabled/removed',
  `joined_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_active_at` DATETIME(3) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tp_project_member_user` (`project_id`, `user_id`),
  KEY `idx_tp_project_member_user_status` (`user_id`, `status`),
  KEY `idx_tp_project_member_project_role` (`project_id`, `project_role`),
  CONSTRAINT `fk_tp_project_member_project` FOREIGN KEY (`project_id`) REFERENCES `tp_project` (`id`),
  CONSTRAINT `fk_tp_project_member_user` FOREIGN KEY (`user_id`) REFERENCES `sys_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_environment` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `env_code` VARCHAR(64) NOT NULL,
  `env_name` VARCHAR(100) NOT NULL,
  `env_type` VARCHAR(32) NOT NULL DEFAULT 'test' COMMENT 'local/test/staging/prod',
  `base_url` VARCHAR(1000) NOT NULL,
  `allow_execution` TINYINT NOT NULL DEFAULT 1,
  `require_confirm` TINYINT NOT NULL DEFAULT 0,
  `description` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tp_environment_project_code` (`project_id`, `env_code`),
  CONSTRAINT `fk_tp_environment_project` FOREIGN KEY (`project_id`) REFERENCES `tp_project` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_page` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `page_name` VARCHAR(200) NOT NULL,
  `url_pattern` VARCHAR(1000) NULL,
  `description` VARCHAR(1000) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tp_page_project` (`project_id`),
  CONSTRAINT `fk_tp_page_project` FOREIGN KEY (`project_id`) REFERENCES `tp_project` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_component` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `page_id` BIGINT UNSIGNED NULL,
  `component_name` VARCHAR(200) NOT NULL,
  `description` VARCHAR(1000) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tp_component_project_page` (`project_id`, `page_id`),
  CONSTRAINT `fk_tp_component_project` FOREIGN KEY (`project_id`) REFERENCES `tp_project` (`id`),
  CONSTRAINT `fk_tp_component_page` FOREIGN KEY (`page_id`) REFERENCES `tp_page` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_element` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `page_id` BIGINT UNSIGNED NULL,
  `component_id` BIGINT UNSIGNED NULL,
  `element_name` VARCHAR(200) NOT NULL,
  `element_type` VARCHAR(64) NULL,
  `default_action` VARCHAR(64) NULL,
  `primary_locator_id` BIGINT UNSIGNED NULL,
  `source_url` VARCHAR(1000) NULL,
  `text_content` VARCHAR(1000) NULL,
  `tag_name` VARCHAR(64) NULL,
  `attributes_json` JSON NULL,
  `iframe_path_json` JSON NULL,
  `shadow_path_json` JSON NULL,
  `screenshot_artifact_id` BIGINT UNSIGNED NULL,
  `valid_status` TINYINT NOT NULL DEFAULT 2 COMMENT '0 invalid, 1 valid, 2 unknown',
  `last_validated_at` DATETIME(3) NULL,
  `last_error` TEXT NULL,
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '0 deleted, 1 active, 2 disabled',
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tp_element_project_page` (`project_id`, `page_id`),
  KEY `idx_tp_element_component` (`component_id`),
  KEY `idx_tp_element_name` (`element_name`),
  CONSTRAINT `fk_tp_element_project` FOREIGN KEY (`project_id`) REFERENCES `tp_project` (`id`),
  CONSTRAINT `fk_tp_element_page` FOREIGN KEY (`page_id`) REFERENCES `tp_page` (`id`),
  CONSTRAINT `fk_tp_element_component` FOREIGN KEY (`component_id`) REFERENCES `tp_component` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_element_locator` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `element_id` BIGINT UNSIGNED NOT NULL,
  `locator_type` VARCHAR(64) NOT NULL,
  `locator_value` TEXT NOT NULL,
  `locator_expression` TEXT NULL,
  `score` INT NOT NULL DEFAULT 0,
  `is_primary` TINYINT NOT NULL DEFAULT 0,
  `is_unique` TINYINT NOT NULL DEFAULT 0,
  `is_visible` TINYINT NOT NULL DEFAULT 0,
  `is_actionable` TINYINT NOT NULL DEFAULT 0,
  `source` VARCHAR(32) NOT NULL DEFAULT 'recording',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `priority` INT NOT NULL DEFAULT 100,
  `confidence` DECIMAL(5,2) NULL,
  `last_checked_at` DATETIME(3) NULL,
  `last_success_at` DATETIME(3) NULL,
  `last_failed_at` DATETIME(3) NULL,
  `success_count` INT NOT NULL DEFAULT 0,
  `failed_count` INT NOT NULL DEFAULT 0,
  `last_error` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tp_element_locator_element` (`element_id`),
  KEY `idx_tp_element_locator_type` (`locator_type`),
  KEY `idx_tp_element_locator_element_status` (`element_id`, `status`),
  KEY `idx_tp_element_locator_element_priority` (`element_id`, `priority`),
  KEY `idx_tp_element_locator_source` (`source`),
  CONSTRAINT `fk_tp_element_locator_element` FOREIGN KEY (`element_id`) REFERENCES `tp_element` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_element_validation` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `element_id` BIGINT UNSIGNED NOT NULL,
  `environment_id` BIGINT UNSIGNED NULL,
  `url` VARCHAR(1000) NULL,
  `browser` VARCHAR(64) NULL,
  `result` VARCHAR(32) NOT NULL,
  `message` VARCHAR(1000) NULL,
  `detail_json` JSON NULL,
  `validated_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tp_element_validation_element_time` (`element_id`, `created_at`),
  CONSTRAINT `fk_tp_element_validation_element` FOREIGN KEY (`element_id`) REFERENCES `tp_element` (`id`),
  CONSTRAINT `fk_tp_element_validation_environment` FOREIGN KEY (`environment_id`) REFERENCES `tp_environment` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_recording_session` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_no` VARCHAR(64) NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `environment_id` BIGINT UNSIGNED NULL,
  `agent_id` VARCHAR(128) NULL,
  `start_url` VARCHAR(1000) NOT NULL,
  `browser` VARCHAR(64) NOT NULL,
  `mode` VARCHAR(32) NOT NULL COMMENT 'record/pick',
  `status` VARCHAR(32) NOT NULL DEFAULT 'created',
  `created_by` BIGINT UNSIGNED NOT NULL,
  `started_at` DATETIME(3) NULL,
  `stopped_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tp_recording_session_no` (`session_no`),
  KEY `idx_tp_recording_session_project_status` (`project_id`, `status`),
  CONSTRAINT `fk_tp_recording_session_project` FOREIGN KEY (`project_id`) REFERENCES `tp_project` (`id`),
  CONSTRAINT `fk_tp_recording_session_environment` FOREIGN KEY (`environment_id`) REFERENCES `tp_environment` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_recording_event` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `event_order` INT NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `action` VARCHAR(64) NULL,
  `url` VARCHAR(1000) NULL,
  `element_snapshot_json` JSON NULL,
  `locators_json` JSON NULL,
  `input_value_masked` VARCHAR(1000) NULL,
  `event_time` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tp_recording_event_order` (`session_id`, `event_order`),
  CONSTRAINT `fk_tp_recording_event_session` FOREIGN KEY (`session_id`) REFERENCES `tp_recording_session` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_case_group` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `group_name` VARCHAR(200) NOT NULL,
  `description` VARCHAR(1000) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tp_case_group_project` (`project_id`),
  CONSTRAINT `fk_tp_case_group_project` FOREIGN KEY (`project_id`) REFERENCES `tp_project` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_test_case` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `case_group_id` BIGINT UNSIGNED NULL,
  `case_code` VARCHAR(64) NULL,
  `case_name` VARCHAR(200) NOT NULL,
  `case_desc` TEXT NULL,
  `priority` VARCHAR(32) NOT NULL DEFAULT 'medium',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '0 disabled, 1 active',
  `version_no` INT NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tp_test_case_project_code` (`project_id`, `case_code`),
  KEY `idx_tp_test_case_project_group` (`project_id`, `case_group_id`),
  CONSTRAINT `fk_tp_test_case_project` FOREIGN KEY (`project_id`) REFERENCES `tp_project` (`id`),
  CONSTRAINT `fk_tp_test_case_group` FOREIGN KEY (`case_group_id`) REFERENCES `tp_case_group` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_case_step` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `case_id` BIGINT UNSIGNED NOT NULL,
  `step_order` INT NOT NULL,
  `step_name` VARCHAR(200) NULL,
  `action` VARCHAR(64) NOT NULL,
  `element_id` BIGINT UNSIGNED NULL,
  `step_dsl_json` JSON NOT NULL,
  `locator_snapshot_json` JSON NULL,
  `status` TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tp_case_step_order` (`case_id`, `step_order`),
  KEY `idx_tp_case_step_element` (`element_id`),
  CONSTRAINT `fk_tp_case_step_case` FOREIGN KEY (`case_id`) REFERENCES `tp_test_case` (`id`),
  CONSTRAINT `fk_tp_case_step_element` FOREIGN KEY (`element_id`) REFERENCES `tp_element` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_case_version` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `case_id` BIGINT UNSIGNED NOT NULL,
  `version_no` INT NOT NULL,
  `case_snapshot_json` JSON NOT NULL,
  `change_summary` VARCHAR(1000) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tp_case_version` (`case_id`, `version_no`),
  CONSTRAINT `fk_tp_case_version_case` FOREIGN KEY (`case_id`) REFERENCES `tp_test_case` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_step_template` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `template_name` VARCHAR(200) NOT NULL,
  `template_dsl_json` JSON NOT NULL,
  `description` VARCHAR(1000) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tp_step_template_project` (`project_id`),
  CONSTRAINT `fk_tp_step_template_project` FOREIGN KEY (`project_id`) REFERENCES `tp_project` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_variable` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `environment_id` BIGINT UNSIGNED NULL,
  `var_name` VARCHAR(128) NOT NULL,
  `var_value` TEXT NULL,
  `is_secret` TINYINT NOT NULL DEFAULT 0,
  `description` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tp_variable_scope_name` (`project_id`, `environment_id`, `var_name`),
  CONSTRAINT `fk_tp_variable_project` FOREIGN KEY (`project_id`) REFERENCES `tp_project` (`id`),
  CONSTRAINT `fk_tp_variable_environment` FOREIGN KEY (`environment_id`) REFERENCES `tp_environment` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_dataset` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `dataset_name` VARCHAR(200) NOT NULL,
  `schema_json` JSON NULL,
  `rows_json` JSON NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tp_dataset_project` (`project_id`),
  CONSTRAINT `fk_tp_dataset_project` FOREIGN KEY (`project_id`) REFERENCES `tp_project` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_execution_job` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `job_no` VARCHAR(64) NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `environment_id` BIGINT UNSIGNED NULL,
  `trigger_type` VARCHAR(32) NOT NULL DEFAULT 'manual',
  `browser` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'queued',
  `total_cases` INT NOT NULL DEFAULT 0,
  `passed_cases` INT NOT NULL DEFAULT 0,
  `failed_cases` INT NOT NULL DEFAULT 0,
  `skipped_cases` INT NOT NULL DEFAULT 0,
  `config_json` JSON NULL,
  `error_message` TEXT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `queued_at` DATETIME(3) NULL,
  `started_at` DATETIME(3) NULL,
  `finished_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tp_execution_job_no` (`job_no`),
  KEY `idx_tp_execution_job_project_status` (`project_id`, `status`),
  CONSTRAINT `fk_tp_execution_job_project` FOREIGN KEY (`project_id`) REFERENCES `tp_project` (`id`),
  CONSTRAINT `fk_tp_execution_job_environment` FOREIGN KEY (`environment_id`) REFERENCES `tp_environment` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_execution_case_result` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `job_id` BIGINT UNSIGNED NOT NULL,
  `case_id` BIGINT UNSIGNED NOT NULL,
  `case_name` VARCHAR(200) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `duration_ms` INT NULL,
  `error_message` TEXT NULL,
  `started_at` DATETIME(3) NULL,
  `finished_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tp_execution_case_result_job` (`job_id`),
  KEY `idx_tp_execution_case_result_case` (`case_id`),
  CONSTRAINT `fk_tp_execution_case_result_job` FOREIGN KEY (`job_id`) REFERENCES `tp_execution_job` (`id`),
  CONSTRAINT `fk_tp_execution_case_result_case` FOREIGN KEY (`case_id`) REFERENCES `tp_test_case` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_execution_step_result` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `case_result_id` BIGINT UNSIGNED NOT NULL,
  `step_id` BIGINT UNSIGNED NULL,
  `step_order` INT NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `duration_ms` INT NULL,
  `error_message` TEXT NULL,
  `snapshot_json` JSON NULL,
  `started_at` DATETIME(3) NULL,
  `finished_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tp_execution_step_result_case` (`case_result_id`),
  CONSTRAINT `fk_tp_execution_step_result_case_result` FOREIGN KEY (`case_result_id`) REFERENCES `tp_execution_case_result` (`id`),
  CONSTRAINT `fk_tp_execution_step_result_step` FOREIGN KEY (`step_id`) REFERENCES `tp_case_step` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_project_ai_config` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `enable_locator_fallback` TINYINT NOT NULL DEFAULT 1,
  `enable_ai_healing` TINYINT NOT NULL DEFAULT 0,
  `enable_ai_captcha` TINYINT NOT NULL DEFAULT 0,
  `ai_provider` VARCHAR(64) NULL,
  `ai_model` VARCHAR(128) NULL,
  `ai_base_url` VARCHAR(500) NULL,
  `ai_api_key_encrypted` TEXT NULL,
  `ai_timeout_ms` INT NOT NULL DEFAULT 20000,
  `max_ai_attempts` INT NOT NULL DEFAULT 1,
  `auto_promote_healed_locator` TINYINT NOT NULL DEFAULT 0,
  `require_manual_review` TINYINT NOT NULL DEFAULT 1,
  `allow_ai_on_prod` TINYINT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tp_project_ai_config_project` (`project_id`),
  CONSTRAINT `fk_tp_project_ai_config_project` FOREIGN KEY (`project_id`) REFERENCES `tp_project` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_locator_heal_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `element_id` BIGINT UNSIGNED NULL,
  `case_id` BIGINT UNSIGNED NULL,
  `step_id` BIGINT UNSIGNED NULL,
  `job_id` BIGINT UNSIGNED NULL,
  `step_result_id` BIGINT UNSIGNED NULL,
  `page_url` VARCHAR(1000) NULL,
  `page_title` VARCHAR(500) NULL,
  `action` VARCHAR(64) NOT NULL,
  `old_locator_json` JSON NULL,
  `attempted_locators_json` JSON NULL,
  `ai_input_json` JSON NULL,
  `ai_candidates_json` JSON NULL,
  `selected_locator_json` JSON NULL,
  `confidence` DECIMAL(5,2) NULL,
  `reason` TEXT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'generated',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tp_locator_heal_log_project_status` (`project_id`, `status`),
  KEY `idx_tp_locator_heal_log_job` (`job_id`),
  CONSTRAINT `fk_tp_locator_heal_log_project` FOREIGN KEY (`project_id`) REFERENCES `tp_project` (`id`),
  CONSTRAINT `fk_tp_locator_heal_log_element` FOREIGN KEY (`element_id`) REFERENCES `tp_element` (`id`),
  CONSTRAINT `fk_tp_locator_heal_log_case` FOREIGN KEY (`case_id`) REFERENCES `tp_test_case` (`id`),
  CONSTRAINT `fk_tp_locator_heal_log_step` FOREIGN KEY (`step_id`) REFERENCES `tp_case_step` (`id`),
  CONSTRAINT `fk_tp_locator_heal_log_job` FOREIGN KEY (`job_id`) REFERENCES `tp_execution_job` (`id`),
  CONSTRAINT `fk_tp_locator_heal_log_step_result` FOREIGN KEY (`step_result_id`) REFERENCES `tp_execution_step_result` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_artifact` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `job_id` BIGINT UNSIGNED NULL,
  `case_result_id` BIGINT UNSIGNED NULL,
  `step_result_id` BIGINT UNSIGNED NULL,
  `artifact_type` VARCHAR(64) NOT NULL COMMENT 'screenshot/video/trace/report/log',
  `storage_type` VARCHAR(64) NOT NULL DEFAULT 'local',
  `storage_path` VARCHAR(1000) NOT NULL,
  `file_name` VARCHAR(255) NULL,
  `content_type` VARCHAR(128) NULL,
  `file_size` BIGINT UNSIGNED NULL,
  `checksum` VARCHAR(128) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tp_artifact_project` (`project_id`),
  KEY `idx_tp_artifact_job` (`job_id`),
  CONSTRAINT `fk_tp_artifact_project` FOREIGN KEY (`project_id`) REFERENCES `tp_project` (`id`),
  CONSTRAINT `fk_tp_artifact_job` FOREIGN KEY (`job_id`) REFERENCES `tp_execution_job` (`id`),
  CONSTRAINT `fk_tp_artifact_case_result` FOREIGN KEY (`case_result_id`) REFERENCES `tp_execution_case_result` (`id`),
  CONSTRAINT `fk_tp_artifact_step_result` FOREIGN KEY (`step_result_id`) REFERENCES `tp_execution_step_result` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tp_report` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `job_id` BIGINT UNSIGNED NOT NULL,
  `report_name` VARCHAR(200) NOT NULL,
  `report_format` VARCHAR(32) NOT NULL DEFAULT 'html',
  `artifact_id` BIGINT UNSIGNED NULL,
  `summary_json` JSON NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tp_report_project` (`project_id`),
  KEY `idx_tp_report_job` (`job_id`),
  CONSTRAINT `fk_tp_report_project` FOREIGN KEY (`project_id`) REFERENCES `tp_project` (`id`),
  CONSTRAINT `fk_tp_report_job` FOREIGN KEY (`job_id`) REFERENCES `tp_execution_job` (`id`),
  CONSTRAINT `fk_tp_report_artifact` FOREIGN KEY (`artifact_id`) REFERENCES `tp_artifact` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO `sys_role` (`role_code`, `role_name`, `description`) VALUES
  ('admin', '管理员', '系统管理员，拥有全部权限'),
  ('test_lead', '测试负责人', '管理项目内元素、用例、执行和报告'),
  ('tester', '测试人员', '采集元素、编排用例、执行测试和查看报告');

INSERT IGNORE INTO `tp_project` (`project_code`, `project_name`, `description`) VALUES
  ('demo', '默认示例项目', '系统初始化创建的示例项目，可按需修改或禁用');

INSERT IGNORE INTO `tp_project_member` (`project_id`, `user_id`, `project_role`, `status`, `created_by`)
SELECT p.id, u.id, 'project_admin', 'active', u.id
FROM `tp_project` p
JOIN `sys_user` u ON u.username = 'admin'
WHERE p.project_code = 'demo';

INSERT IGNORE INTO `tp_project_member` (`project_id`, `user_id`, `project_role`, `status`, `created_by`)
SELECT p.id, p.owner_id, 'project_admin', 'active', p.owner_id
FROM `tp_project` p
WHERE p.owner_id IS NOT NULL;

INSERT IGNORE INTO `tp_project_member` (`project_id`, `user_id`, `project_role`, `status`, `created_by`)
SELECT p.id, u.id, 'project_admin', 'active', u.id
FROM `tp_project` p
JOIN `sys_user` u ON u.username = 'admin';
