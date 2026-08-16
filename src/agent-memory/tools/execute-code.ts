import { getQuickJS } from 'quickjs-emscripten'
import { z } from 'zod'
import { 智能体工具 } from '../../agent/types'

let 沙盒执行超时毫秒 = 5000

function 格式化沙盒错误(错误: unknown): string {
  if (typeof 错误 === 'string') return 错误

  let 错误对象 = z
    .object({ message: z.string().optional(), stack: z.string().optional() })
    .passthrough()
    .safeParse(错误)
  if (错误对象.success === true) {
    if (错误对象.data.stack !== undefined) return 错误对象.data.stack
    if (错误对象.data.message !== undefined) return 错误对象.data.message
  }

  try {
    return JSON.stringify(错误)
  } catch (_错误: unknown) {
    return String(错误)
  }
}

export let 执行代码工具 = 智能体工具.创建({
  名称: 'execute_code',
  描述: '在一个极其严格隔离的 JavaScript 沙盒环境中执行代码。你可以用它来进行纯 JS 实验、计算、数据验证等。沙盒内部不支持 require，也没有文件读写或网络请求的权限。代码将在一个异步函数 (async function) 中执行，因此你可以使用 await。请将你需要返回的结果通过 return 语句返回。如果在执行中发生报错，错误堆栈将被返回。',
  参数Schema: z.object({
    代码: z
      .string()
      .describe('要执行的纯 JavaScript 代码字符串，必须包含 return 语句以返回结果。例如: "return 1 + 1;"'),
  }),
  返回值Schema: z.object({
    结果: z.enum(['成功', '失败']),
    执行输出: z.string().optional().describe('如果代码正常返回，这是将结果序列化后的字符串形式。'),
    错误信息: z.string().optional().describe('如果代码执行抛出异常，这是异常的详细信息。'),
  }),
  实现: async (参数: { 代码: string }): Promise<{ 结果: '成功' | '失败'; 执行输出?: string; 错误信息?: string }> => {
    let QuickJS = await getQuickJS()
    let runtime = QuickJS.newRuntime()
    let 开始时间 = Date.now()
    runtime.setInterruptHandler(() => Date.now() - 开始时间 > 沙盒执行超时毫秒)

    let context = runtime.newContext()
    try {
      let 包装代码 = `
        (async (用户代码) => {
          let 日志输出 = [];
          let console = {
            log: (...args) => 日志输出.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
            warn: (...args) => 日志输出.push('[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
            error: (...args) => 日志输出.push('[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
          };

          let AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
          let 包装函数 = new AsyncFunction('console', 用户代码);

          try {
            let 运行结果 = await 包装函数(console);
            return JSON.stringify({ 运行结果, 日志输出 });
          } catch (error) {
            return JSON.stringify({
              错误信息: error instanceof Error ? error.message : String(error),
              日志输出
            });
          }
        })
      `

      let 执行包装 = context.evalCode(包装代码)
      if (执行包装.error !== undefined) {
        let 错误信息 = 格式化沙盒错误(context.dump(执行包装.error))
        执行包装.error.dispose()
        throw new Error(错误信息)
      }

      let 用户代码句柄 = context.newString(参数.代码)
      let 初始执行结果 = context.callFunction(执行包装.value, context.undefined, 用户代码句柄)
      用户代码句柄.dispose()
      执行包装.value.dispose()

      if (初始执行结果.error !== undefined) {
        let 错误信息 = 格式化沙盒错误(context.dump(初始执行结果.error))
        初始执行结果.error.dispose()
        throw new Error(错误信息)
      }

      // 先注册 Promise 监听器，得到 Node.js 中的 Promise
      let 解决期约 = context.resolvePromise(初始执行结果.value)

      // 执行 pending jobs，驱动 QuickJS 内部结算该 Promise
      runtime.executePendingJobs()

      // 等待 Promise 解析
      let 解决后的结果: Awaited<typeof 解决期约> | undefined
      let 超时定时器: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        解决期约.then((结果): void => {
          解决后的结果 = 结果
        }),
        new Promise<void>((resolve): void => {
          超时定时器 = setTimeout(resolve, 沙盒执行超时毫秒)
        }),
      ])
      if (超时定时器 !== undefined) {
        clearTimeout(超时定时器)
      }
      初始执行结果.value.dispose() // 丢弃原始的 promise 句柄

      if (解决后的结果 === undefined) {
        throw new Error(`代码执行超时（${String(沙盒执行超时毫秒)}ms）`)
      }

      if (解决后的结果.error !== undefined) {
        let 错误信息 = 格式化沙盒错误(context.dump(解决后的结果.error))
        解决后的结果.error.dispose()
        throw new Error(错误信息)
      }

      let 结果JSON字符串 = context.getString(解决后的结果.value)
      解决后的结果.value.dispose()

      let 解析结果 = z
        .object({ 运行结果: z.unknown().optional(), 日志输出: z.array(z.string()), 错误信息: z.string().optional() })
        .parse(JSON.parse(结果JSON字符串))
      if (解析结果.错误信息 !== undefined) {
        throw new Error(解析结果.错误信息)
      }
      let 运行结果 = 解析结果.运行结果
      let 日志输出 = 解析结果.日志输出

      let 最终输出 = ''
      if (Array.isArray(日志输出) && 日志输出.length > 0) {
        最终输出 += '【Console 输出】:\\n' + 日志输出.join('\\n') + '\\n\\n'
      }

      最终输出 +=
        '【Return 结果】:\\n' + (typeof 运行结果 === 'object' ? JSON.stringify(运行结果, null, 2) : String(运行结果))

      return { 结果: '成功', 执行输出: 最终输出 }
    } catch (error: unknown) {
      return { 结果: '失败', 错误信息: String(error instanceof Error ? (error.stack ?? error.message) : error) }
    } finally {
      context.dispose()
      runtime.dispose()
    }
  },
})
