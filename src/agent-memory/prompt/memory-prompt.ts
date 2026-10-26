import { 中文模型语言包, type 模型语言包 } from '../../agent/model-language'

/** 按启用的工具名，通过模型语言包生成固定的记忆操作指南。 */
export function 生成默认记忆提示词(启用的工具名: readonly string[], 模型语言包: 模型语言包 = 中文模型语言包): string {
  return 模型语言包.默认记忆提示词(启用的工具名)
}
