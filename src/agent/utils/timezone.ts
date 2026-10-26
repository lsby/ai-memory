let 格式化器缓存 = new Map<string, Intl.DateTimeFormat>()

function 取格式化器(时区: string): Intl.DateTimeFormat {
  let 已有 = 格式化器缓存.get(时区)
  if (已有 !== undefined) return 已有
  let 新建: Intl.DateTimeFormat
  try {
    新建 = new Intl.DateTimeFormat('en-US', {
      timeZone: 时区,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch (_错误) {
    throw new Error(`时区 "${时区}" 不是有效的 IANA 时区名 (例如 Asia/Shanghai、America/New_York、UTC)`)
  }
  格式化器缓存.set(时区, 新建)
  return 新建
}

/** 校验 IANA 时区名, 非法时抛出带清楚说明的错误 */
export function 校验时区(时区: string): void {
  取格式化器(时区)
}

function 补零(值: number, 位数: number): string {
  return String(Math.abs(值)).padStart(位数, '0')
}

/** 把时间格式化成指定 IANA 时区的 ISO 字符串, 带偏移, 如 2026-01-01T08:00:00.000+08:00 */
export function 格式化为指定时区时间(时间: Date, 时区: string): string {
  let 分项 = new Map<string, number>()
  for (let 部分 of 取格式化器(时区).formatToParts(时间)) {
    if (部分.type !== 'literal') 分项.set(部分.type, Number(部分.value))
  }
  let 取 = (类型: string): number => 分项.get(类型) ?? 0
  let 毫秒 = 时间.getUTCMilliseconds()
  let 本地当作UTC的毫秒 = Date.UTC(取('year'), 取('month') - 1, 取('day'), 取('hour'), 取('minute'), 取('second'))
  let 偏移分钟 = Math.round((本地当作UTC的毫秒 - (时间.getTime() - 毫秒)) / 60000)
  let 符号 = 偏移分钟 < 0 ? '-' : '+'
  let 绝对偏移 = Math.abs(偏移分钟)
  return `${补零(取('year'), 4)}-${补零(取('month'), 2)}-${补零(取('day'), 2)}T${补零(取('hour'), 2)}:${补零(取('minute'), 2)}:${补零(取('second'), 2)}.${补零(毫秒, 3)}${符号}${补零(Math.floor(绝对偏移 / 60), 2)}:${补零(绝对偏移 % 60, 2)}`
}
