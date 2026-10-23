/** 请求体里由库自己管理的字段, 不允许被 额外请求参数 覆盖 */
let 库管理的请求字段: readonly string[] = ['model', 'messages', 'tools', 'stream', 'stream_options']

/** 校验并复制 额外请求参数: 含有库自己管理的字段时报错, 返回副本避免调用方事后改动 */
export function 校验并复制额外请求参数(
  额外请求参数: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (额外请求参数 === undefined) return undefined
  let 冲突字段 = Object.keys(额外请求参数).filter((字段) => 库管理的请求字段.includes(字段))
  if (冲突字段.length > 0)
    throw new Error(
      `额外请求参数 不能包含库自己管理的字段: ${冲突字段.join(', ')} (库管理的字段: ${库管理的请求字段.join(', ')})`,
    )
  return { ...额外请求参数 }
}
