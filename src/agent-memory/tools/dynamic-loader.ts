import Ajv from 'ajv'
import { getQuickJS } from 'quickjs-emscripten'
import { z } from 'zod'

let 沙盒执行超时毫秒 = 5000

export type 加载后的动态工具 = {
  名称: string
  描述: string
  参数Schema: Record<string, unknown>
  返回值Schema: Record<string, unknown>
  实现: (参数json: string) => Promise<string>
}

/**
 * 在 QuickJS 沙盒中加载并校验动态工具代码。
 *
 * 工具代码约定格式（纯 JavaScript）:
 * ```js
 * 工具 = {
 *   名称: "tool_name",
 *   描述: "这个工具做什么",
 *   参数Schema描述: '{"city": "string, 城市名称"}',
 *   返回值Schema描述: '{"temperature": "number, 温度"}',
 *   实现: async function(参数) { return { temperature: 25 }; }
 * };
 * ```
 * 沙盒中没有 require/import、无文件系统、无网络访问。
 */
export async function 加载并校验动态工具(
  代码字符串: string,
): Promise<{ 成功: true; 工具: 加载后的动态工具 } | { 成功: false; 错误信息: string }> {
  let QuickJS = await getQuickJS()
  let runtime = QuickJS.newRuntime()
  let 开始时间 = Date.now()
  runtime.setInterruptHandler(() => Date.now() - 开始时间 > 3000)
  let context = runtime.newContext()

  try {
    // 包装代码：执行用户代码后提取工具元信息
    let 包装代码 = `
      (function() {
        let 工具;
        ${代码字符串}
        if (typeof 工具 === 'undefined' || 工具 === null) {
          return JSON.stringify({ 错误: '代码中必须声明一个名为「工具」的变量' });
        }
        if (typeof 工具.名称 !== 'string' || 工具.名称 === '') {
          return JSON.stringify({ 错误: '工具必须包含非空的「名称」字段 (string)' });
        }
        if (typeof 工具.描述 !== 'string' || 工具.描述 === '') {
          return JSON.stringify({ 错误: '工具必须包含非空的「描述」字段 (string)' });
        }
        if (typeof 工具.参数Schema !== 'object' || 工具.参数Schema === null) {
          return JSON.stringify({ 错误: '工具必须包含「参数Schema」字段 (object)' });
        }
        if (工具.参数Schema.type !== 'object' || typeof 工具.参数Schema.properties !== 'object') {
          return JSON.stringify({ 错误: '「参数Schema」必须是标准的 JSON Schema，且 type 必须为 object，必须包含 properties' });
        }
        if (typeof 工具.返回值Schema !== 'object' || 工具.返回值Schema === null) {
          return JSON.stringify({ 错误: '工具必须包含「返回值Schema」字段 (object)' });
        }
        if (工具.返回值Schema.type !== 'object' || typeof 工具.返回值Schema.properties !== 'object') {
          return JSON.stringify({ 错误: '「返回值Schema」必须是标准的 JSON Schema，且 type 必须为 object，必须包含 properties' });
        }
        if (typeof 工具.实现 !== 'function') {
          return JSON.stringify({ 错误: '工具必须包含「实现」字段 (function)' });
        }
        return JSON.stringify({
          名称: 工具.名称,
          描述: 工具.描述,
          参数Schema: 工具.参数Schema,
          返回值Schema: 工具.返回值Schema,
        });
      })()
    `

    let 元信息结果 = context.evalCode(包装代码)
    if (元信息结果.error !== undefined) {
      let 错误信息: unknown = context.dump(元信息结果.error)
      元信息结果.error.dispose()
      return { 成功: false, 错误信息: `代码编译/执行出错: ${String(错误信息)}` }
    }

    let 元信息JSON = context.getString(元信息结果.value)
    元信息结果.value.dispose()

    let 元信息Schema = z.object({
      错误: z.string().optional(),
      名称: z.string().optional(),
      描述: z.string().optional(),
      参数Schema: z.record(z.unknown()).optional(),
      返回值Schema: z.record(z.unknown()).optional(),
    })
    let 元信息 = 元信息Schema.parse(JSON.parse(元信息JSON))
    if (元信息.错误 !== undefined) {
      return { 成功: false, 错误信息: 元信息.错误 }
    }

    // 构建一个可重复调用的执行器
    let 工具实例: 加载后的动态工具 = {
      名称: 元信息.名称 ?? '',
      描述: 元信息.描述 ?? '',
      参数Schema: 元信息.参数Schema ?? {},
      返回值Schema: 元信息.返回值Schema ?? {},
      实现: async (参数json: string): Promise<string> => {
        // 每次调用都创建新的沙盒上下文，确保隔离
        return await 在沙盒中执行工具(代码字符串, 参数json, 元信息.参数Schema, 元信息.返回值Schema)
      },
    }

    return { 成功: true, 工具: 工具实例 }
  } catch (error: unknown) {
    return { 成功: false, 错误信息: String(error instanceof Error ? (error.stack ?? error.message) : error) }
  } finally {
    context.dispose()
    runtime.dispose()
  }
}

function validateJsonSchema(schema: unknown, data: unknown, prefix: string): void {
  let JSON模式 = z.record(z.unknown()).parse(schema)
  let 校验器 = new Ajv({ allErrors: true, strict: false })
  let 校验函数 = 校验器.compile(JSON模式)
  if (校验函数(data) === false) {
    let 错误信息 = 校验器.errorsText(校验函数.errors, { separator: '; ' })
    throw new Error(`${prefix} 不符合 JSON Schema: ${错误信息}`)
  }
}

/**
 * 在全新的沙盒中执行动态工具的实现函数，传入参数 JSON 并返回结果 JSON。
 */
export async function 在沙盒中执行工具(
  代码字符串: string,
  参数json: string,
  参数Schema?: unknown,
  返回值Schema?: unknown,
): Promise<string> {
  if (参数Schema !== undefined) {
    validateJsonSchema(参数Schema, JSON.parse(参数json), '输入参数')
  }

  let QuickJS = await getQuickJS()
  let runtime = QuickJS.newRuntime()
  let 开始时间 = Date.now()
  runtime.setInterruptHandler(() => Date.now() - 开始时间 > 沙盒执行超时毫秒)
  let context = runtime.newContext()

  try {
    let 执行代码 = `
      (async function() {
        let 工具;
        ${代码字符串}
        let 参数 = JSON.parse(${JSON.stringify(参数json)});
        let 结果 = await 工具.实现(参数);
        return JSON.stringify(结果);
      })()
    `

    let 初始执行结果 = context.evalCode(执行代码)
    if (初始执行结果.error !== undefined) {
      let 错误信息: unknown = context.dump(初始执行结果.error)
      初始执行结果.error.dispose()
      throw new Error(String(错误信息))
    }

    let 解决期约 = context.resolvePromise(初始执行结果.value)
    runtime.executePendingJobs()
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
    初始执行结果.value.dispose()

    if (解决后的结果 === undefined) {
      throw new Error(`动态工具执行超时（${String(沙盒执行超时毫秒)}ms）`)
    }

    if (解决后的结果.error !== undefined) {
      let 错误信息: unknown = context.dump(解决后的结果.error)
      解决后的结果.error.dispose()
      throw new Error(String(错误信息))
    }

    let 结果字符串 = context.getString(解决后的结果.value)
    解决后的结果.value.dispose()

    if (返回值Schema !== undefined) {
      validateJsonSchema(返回值Schema, JSON.parse(结果字符串), '返回值')
    }

    return 结果字符串
  } finally {
    context.dispose()
    runtime.dispose()
  }
}
