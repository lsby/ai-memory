import type { 模型语言包 } from '../model-language'
import type { 内部注入消息, 智能体消息类型 } from '../types'
import { 格式化为指定时区时间 } from '../utils/timezone'
import { 计算内容指纹 } from './prefix'

/**
 * 把注入消息追加到消息列表末尾(按传入顺序)。
 * 按 类型 在列表里找同类型的最后一条, 内容指纹一样就不追加, 不一样才追加; 总是追加 的注入不去重。
 */
export function 追加注入消息到列表(消息列表: 智能体消息类型[], 注入列表: 内部注入消息[]): void {
  for (let 注入 of 注入列表) {
    let 指纹 = 注入.指纹 ?? 计算内容指纹(注入.内容)
    if (注入.总是追加 !== true) {
      let 上一条 = 消息列表.findLast(
        (消息) => 消息.role === 'user' && 消息.isSystemInjection === true && 消息.systemInjectionKind === 注入.类型,
      )
      if (上一条?.role === 'user' && 上一条.systemInjectionFingerprint === 指纹) continue
    }
    消息列表.push({
      role: 'user',
      content: 注入.内容,
      isSystemInjection: true,
      systemInjectionKind: 注入.类型,
      systemInjectionFingerprint: 指纹,
    })
  }
}

/** 时间的 ISO 字符串, 带时区偏移。不传时区用服务器时区, 传了按 IANA 时区名 */
export function 格式化当前时间(当前时间: Date, 时区?: string): string {
  if (时区 !== undefined) return 格式化为指定时区时间(当前时间, 时区)
  let 偏移分钟 = 当前时间.getTimezoneOffset()
  let 本地时间 = new Date(当前时间.getTime() - 偏移分钟 * 60000)
  let iso部分 = 本地时间.toISOString().slice(0, -1)
  let 符号 = 偏移分钟 > 0 ? '-' : '+'
  let 绝对值偏移 = Math.abs(偏移分钟)
  let 偏移小时 = Math.floor(绝对值偏移 / 60)
    .toString()
    .padStart(2, '0')
  let 偏移分 = (绝对值偏移 % 60).toString().padStart(2, '0')
  return `${iso部分}${符号}${偏移小时}:${偏移分}`
}

export function 构建当前时间注入(当前时间: Date, 时区: string | undefined, 模型语言包: 模型语言包): string {
  return 模型语言包.当前时间(格式化当前时间(当前时间, 时区))
}

/** 组装请求用: 在消息列表的插入位置处插入本轮临时消息(user 角色), 返回新数组, 不改动原列表 */
export function 插入本轮临时消息(消息列表: 智能体消息类型[], 插入位置: number, 临时消息?: string[]): 智能体消息类型[] {
  if (临时消息 === undefined || 临时消息.length === 0) return 消息列表
  let 临时消息列表: 智能体消息类型[] = 临时消息.map((内容) => ({ role: 'user', content: 内容 }))
  return [...消息列表.slice(0, 插入位置), ...临时消息列表, ...消息列表.slice(插入位置)]
}
