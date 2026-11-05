import { z } from 'zod'

export let 过滤内容模式Schema = z
  .enum(['and', 'or'])
  .default('and')
  .describe('多个过滤条件的组合方式。"and" 要求全部满足，"or" 要求至少满足一个；默认为 "and"')
export type 过滤内容模式 = z.infer<typeof 过滤内容模式Schema>

export let 时间范围Schema = z
  .object({
    开始时间: z
      .string()
      .refine((值): boolean => Number.isNaN(new Date(值).getTime()) === false, '开始时间必须是有效的日期或时间')
      .describe('创建时间下界，可传 ISO 日期或时间，包含此边界')
      .optional(),
    结束时间: z
      .string()
      .refine((值): boolean => Number.isNaN(new Date(值).getTime()) === false, '结束时间必须是有效的日期或时间')
      .describe('创建时间上界，可传 ISO 日期或时间，不包含此边界')
      .optional(),
  })
  .strict()
  .describe('按绝对创建时间过滤；开始时间包含边界，结束时间不包含边界')
export type 时间范围 = z.infer<typeof 时间范围Schema>

export function 解析时间范围(时间范围: 时间范围 | undefined): { 开始时间: Date | null; 结束时间: Date | null } {
  if (时间范围 === undefined) return { 开始时间: null, 结束时间: null }
  let 开始时间 = 时间范围.开始时间 === undefined ? null : new Date(时间范围.开始时间)
  let 结束时间 = 时间范围.结束时间 === undefined ? null : new Date(时间范围.结束时间)
  if (开始时间 !== null && 结束时间 !== null && 开始时间 >= 结束时间) {
    throw new Error('时间范围无效：开始时间必须早于结束时间')
  }
  return { 开始时间, 结束时间 }
}

export function 符合过滤内容模式(条件列表: boolean[], 模式: 过滤内容模式): boolean {
  if (条件列表.length === 0) return true
  switch (模式) {
    case 'and':
      return 条件列表.every((条件) => 条件)
    case 'or':
      return 条件列表.some((条件) => 条件)
  }
}
