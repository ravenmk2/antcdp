const issues: Record<string, string> = {
  SKILL_ARCHIVE_INVALID: "ZIP 格式无效",
  SKILL_ARCHIVE_TOO_LARGE: "压缩包超过大小上限",
  SKILL_ARCHIVE_ENCRYPTED: "不支持加密 ZIP",
  SKILL_NAME_MISMATCH: "规范名称与技能或顶层目录不一致",
  SKILL_NAME_INVALID: "技能名称格式无效",
  SKILL_DESCRIPTION_INVALID: "SKILL.md 描述无效或超过上限",
  SKILL_MANIFEST_MISSING: "缺少 SKILL.md",
  SKILL_FRONTMATTER_MISSING: "SKILL.md 缺少元数据",
  SKILL_FRONTMATTER_INVALID: "SKILL.md 元数据格式无效",
  SKILL_PATH_INVALID: "包含不安全路径",
  SKILL_PATH_CONFLICT: "文件与目录路径冲突",
  SKILL_DUPLICATE_PATH: "存在重复路径",
  SKILL_MULTIPLE_ROOTS: "技能包包含多个顶层目录",
  SKILL_SPECIAL_FILE: "包含链接或特殊文件",
  SKILL_FILE_TOO_LARGE: "单个文件超过上限",
  SKILL_FILE_COUNT_INVALID: "文件数量不符合要求",
  SKILL_EXPANDED_TOO_LARGE: "解压总大小超过上限",
  SKILL_COMPRESSION_RATIO: "压缩比超过上限",
  SKILL_MANIFEST_TOO_LARGE: "文件清单超过上限",
  SKILL_VALIDATION_TIMEOUT: "技能包校验超时",
  SKILL_INTEGRITY_FAILED: "技能包完整性校验失败",
};
export function skillUploadIssue(code: string) {
  return issues[code] ?? `校验未通过（${code}）`;
}
