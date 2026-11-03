import { z } from 'zod'

export let 过滤内容模式Schema = z
  .enum(['与', '或'])
  .default('与')
  .describe('多个过滤条件的组合方式。“与”要求全部满足，“或”要求至少满足一个；默认为“与”')
export type 过滤内容模式 = z.infer<typeof 过滤内容模式Schema>

export let 时间范围Schema = z
  .object({
    基准: z
      .string()
      .refine((值): boolean => Number.isNaN(new Date(值).getTime()) === false, '基准必须是有效的日期或时间')
      .describe('相对时间的计算基准，可传 ISO 日期或时间；不填时使用当前时间')
      .optional(),
    开始相对天数: z.number().finite().nonnegative().describe('开始时间等于基准减去该天数，包含此边界').optional(),
    结束相对天数: z.number().finite().nonnegative().describe('结束时间等于基准减去该天数，不包含此边界').optional(),
  })
  .strict()
  .describe('按创建时间过滤；所有相对天数均以同一个基准计算')
export type 时间范围 = z.infer<typeof 时间范围Schema>

export function 解析时间范围(时间范围: 时间范围 | undefined): { 开始时间: Date | null; 结束时间: Date | null } {
  if (时间范围 === undefined) return { 开始时间: null, 结束时间: null }
  let 基准时间 = 时间范围.基准 === undefined ? new Date() : new Date(时间范围.基准)
  let 一天毫秒数 = 24 * 60 * 60 * 1000
  let 开始时间 =
    时间范围.开始相对天数 === undefined ? null : new Date(基准时间.getTime() - 时间范围.开始相对天数 * 一天毫秒数)
  let 结束时间 =
    时间范围.结束相对天数 === undefined ? null : new Date(基准时间.getTime() - 时间范围.结束相对天数 * 一天毫秒数)
  if (开始时间 !== null && 结束时间 !== null && 开始时间 >= 结束时间) {
    throw new Error('时间范围无效：开始时间必须早于结束时间')
  }
  return { 开始时间, 结束时间 }
}

export function 符合过滤内容模式(条件列表: boolean[], 模式: 过滤内容模式): boolean {
  if (条件列表.length === 0) return true
  switch (模式) {
    case '与':
      return 条件列表.every((条件) => 条件)
    case '或':
      return 条件列表.some((条件) => 条件)
  }
}
