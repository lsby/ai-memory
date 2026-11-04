import { z } from 'zod'
import { 智能体工具 } from '../../../../src/agent/types'

let weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

let weekdayNameToIndex: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

function parseFlexibleDate(dateStr: string): Date {
  let trimmed = dateStr.trim()
  let isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(trimmed)
  if (isoMatch !== null) {
    let year = Number(isoMatch[1])
    let month = Number(isoMatch[2]) - 1
    let day = Number(isoMatch[3])
    return new Date(Date.UTC(year, month, day, 12, 0, 0))
  }
  let yearOnlyMatch = /^(\d{4})$/.exec(trimmed)
  if (yearOnlyMatch !== null) {
    return new Date(Date.UTC(Number(yearOnlyMatch[1]), 0, 1, 12, 0, 0))
  }
  let d = new Date(trimmed)
  if (Number.isNaN(d.getTime()) === false) {
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0))
  }
  throw new Error(`Unable to parse date string: "${dateStr}"`)
}

function formatDateISO(d: Date): string {
  let y = d.getUTCFullYear()
  let m = String(d.getUTCMonth() + 1).padStart(2, '0')
  let day = String(d.getUTCDate()).padStart(2, '0')
  return `${String(y)}-${m}-${day}`
}

let dateCalculatorInputSchema = z.object({
  action: z
    .enum(['offset', 'day_of_week', 'difference', 'parse'])
    .describe(
      'The date calculation action: "offset" (add/subtract days, weeks, months, or relative weekdays), "day_of_week" (determine which day of the week a date falls on), "difference" (calculate time between two dates), or "parse" (standardize date into ISO string, year, month, day, day-of-week)',
    ),
  base_date: z.string().describe('Base date string, e.g. "2023-05-10", "May 10, 2023", or session timestamp'),
  target_date: z.string().nullable().optional().describe('Target date string when action is "difference"'),
  years: z.number().nullable().optional().describe('Years to add (positive) or subtract (negative)'),
  months: z.number().nullable().optional().describe('Months to add (positive) or subtract (negative)'),
  weeks: z.number().nullable().optional().describe('Weeks to add (positive) or subtract (negative)'),
  days: z.number().nullable().optional().describe('Days to add (positive) or subtract (negative)'),
  relative_weekday: z
    .enum([
      'last_sunday',
      'last_monday',
      'last_tuesday',
      'last_wednesday',
      'last_thursday',
      'last_friday',
      'last_saturday',
      'next_sunday',
      'next_monday',
      'next_tuesday',
      'next_wednesday',
      'next_thursday',
      'next_friday',
      'next_saturday',
    ])
    .nullable()
    .optional()
    .describe('Relative weekday offset, e.g. "last_sunday" or "next_friday" relative to base_date'),
})

let dateCalculatorOutputSchema = z.object({
  结果: z.enum(['成功', '失败']),
  result: z.string().describe('The formatted calculation result'),
  details: z.record(z.unknown()).describe('Detailed calculation metadata'),
})

export let dateCalculatorTool = 智能体工具.创建({
  名称: 'date_calculator',
  描述: 'Perform calendar arithmetic, date offsets, day-of-week lookups, and duration differences. Use this whenever you need to compute when an event took place (e.g. "last Sunday", "3 days ago", "two weeks after May 1st", or what day of week a date fell on) instead of doing mental math.',
  参数Schema: dateCalculatorInputSchema,
  返回值Schema: dateCalculatorOutputSchema,
  实现: async (params) => {
    try {
      let baseDate = parseFlexibleDate(params.base_date)
      let baseDayOfWeek = weekdays[baseDate.getUTCDay()] ?? 'Unknown'

      if (params.action === 'day_of_week') {
        let iso = formatDateISO(baseDate)
        return {
          结果: '成功',
          result: `${iso} is a ${baseDayOfWeek}`,
          details: {
            date: iso,
            day_of_week: baseDayOfWeek,
            year: baseDate.getUTCFullYear(),
            month: baseDate.getUTCMonth() + 1,
            day: baseDate.getUTCDate(),
          },
        }
      }

      if (params.action === 'parse') {
        let iso = formatDateISO(baseDate)
        return {
          结果: '成功',
          result: `${iso} (${baseDayOfWeek})`,
          details: {
            iso_date: iso,
            day_of_week: baseDayOfWeek,
            year: baseDate.getUTCFullYear(),
            month: baseDate.getUTCMonth() + 1,
            day: baseDate.getUTCDate(),
          },
        }
      }

      if (params.action === 'offset') {
        let y = baseDate.getUTCFullYear() + (params.years ?? 0)
        let m = baseDate.getUTCMonth() + (params.months ?? 0)
        let totalDays =
          (params.days ?? 0) + (params.weeks !== null && params.weeks !== undefined ? params.weeks * 7 : 0)

        // 如果指定了相对星期，例如 last_sunday
        if (params.relative_weekday !== null && params.relative_weekday !== undefined) {
          let parts = params.relative_weekday.split('_')
          let direction = parts[0]
          let targetDayName = parts[1] ?? 'sunday'
          let targetDayIdx = weekdayNameToIndex[targetDayName] ?? 0
          let currentDayIdx = baseDate.getUTCDay()

          let diff = targetDayIdx - currentDayIdx
          if (direction === 'last') {
            if (diff >= 0) {
              diff -= 7
            }
          } else if (direction === 'next') {
            if (diff <= 0) {
              diff += 7
            }
          }
          totalDays += diff
        }

        let resultDate = new Date(Date.UTC(y, m, baseDate.getUTCDate() + totalDays, 12, 0, 0))
        let resultIso = formatDateISO(resultDate)
        let resultDayOfWeek = weekdays[resultDate.getUTCDay()] ?? 'Unknown'

        return {
          结果: '成功',
          result: `${resultIso} (${resultDayOfWeek})`,
          details: {
            base_date: formatDateISO(baseDate),
            result_date: resultIso,
            day_of_week: resultDayOfWeek,
            year: resultDate.getUTCFullYear(),
            month: resultDate.getUTCMonth() + 1,
            day: resultDate.getUTCDate(),
          },
        }
      }

      if (params.target_date === null || params.target_date === undefined) {
        return {
          结果: '失败',
          result: 'target_date is required when calculating difference',
          details: {},
        }
      }
      let targetDate = parseFlexibleDate(params.target_date)
      let diffMs = targetDate.getTime() - baseDate.getTime()
      let diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
      let absDays = Math.abs(diffDays)
      let yearsDiff = targetDate.getUTCFullYear() - baseDate.getUTCFullYear()

      return {
        结果: '成功',
        result: `${String(diffDays)} days (approx ${String(yearsDiff)} years)`,
        details: {
          base_date: formatDateISO(baseDate),
          target_date: formatDateISO(targetDate),
          difference_days: diffDays,
          absolute_days: absDays,
          approx_weeks: (absDays / 7).toFixed(1),
          years_difference: yearsDiff,
        },
      }
    } catch (err: unknown) {
      let message = err instanceof Error ? err.message : String(err)
      return {
        结果: '失败',
        result: `Date calculation failed: ${message}`,
        details: { error: message },
      }
    }
  },
})
