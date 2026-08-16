import * as fs from 'fs'
import * as readline from 'node:readline/promises'
import type { z } from 'zod'
import type { 带记忆的智能体 } from '../agent-memory/agent-memory'
import type { 智能体 } from './agent'
import type { REPL选项, 智能体事件, 智能体消息类型, 调试拦截钩子 } from './types'

export async function 开启交互调试<T extends z.ZodType>(
  智能体实例: 智能体 | 带记忆的智能体,
  选项: REPL选项<T>,
): Promise<void> {
  let rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  let 拦截策略数组 = 选项.拦截策略 ?? []
  let 状态文件路径 = 选项.状态文件路径
  let 自动保存 = 选项.自动保存 ?? false

  let 消息历史: 智能体消息类型[] = 选项.消息历史 ?? []

  let 原始命令 = 选项.命令

  if (状态文件路径 !== undefined && fs.existsSync(状态文件路径)) {
    let ans = await rl.question(`检测到存档文件 ${状态文件路径}，是否读取？(y/n) [n]: `)
    if (ans.trim().toLowerCase() === 'y') {
      let state = fs.readFileSync(状态文件路径, 'utf-8')
      消息历史 = await 智能体实例.导入完整状态(state)
      console.log('已恢复存档状态。')
    }
  }
  选项.消息历史 = 消息历史

  if (消息历史.length === 0) {
    console.log('\n[REPL] 当前没有历史记录。')
  } else {
    console.log('\n[REPL] --- 历史记录 (最后 5 条) ---')
    let lastFew = 消息历史.slice(-5)
    for (let msg of lastFew) {
      let contentStr = ''
      if (msg.role === 'tool') {
        let contentVal = typeof msg.content === 'string' ? msg.content : ''
        contentStr = `[工具返回: ${contentVal.slice(0, 20)}...]`
      } else if (msg.role === 'assistant') {
        let parts: string[] = []
        if (msg.content !== null) {
          if (typeof msg.content === 'string') {
            if (msg.content !== '') parts.push(msg.content)
          } else {
            parts.push(JSON.stringify(msg.content))
          }
        }
        if (msg.tool_calls !== undefined && msg.tool_calls.length > 0) {
          parts.push(`[调用工具: ${msg.tool_calls.map((t) => t.function.name).join(', ')}]`)
        }
        contentStr = parts.length > 0 ? parts.join(' ') : '<无文本内容>'
      } else {
        if (msg.content === null) {
          contentStr = '<无文本内容>'
        } else if (typeof msg.content === 'string') {
          contentStr = msg.content !== '' ? msg.content : '<无文本内容>'
        } else {
          contentStr = JSON.stringify(msg.content)
        }
      }
      if (contentStr.length > 100) contentStr = contentStr.substring(0, 100) + '...'
      console.log(`[${msg.role}]: ${contentStr}`)
    }
    console.log('--------------------------------\n')
  }

  while (true) {
    let ans = await rl.question('[REPL] 请输入 /start 发送初始命令，或直接输入 <自定义文本> 继续，或 /exit 退出: ')
    ans = ans.trim()
    if (ans === '/start') {
      选项.命令 = 原始命令
      break
    } else if (ans === '/exit') {
      rl.close()
      process.exit(0)
    } else if (ans !== '') {
      选项.命令 = ans
      break
    }
  }

  let 执行保存 = async (当前历史: 智能体消息类型[]): Promise<void> => {
    if (状态文件路径 !== undefined) {
      let state = await 智能体实例.导出完整状态(当前历史)
      fs.writeFileSync(状态文件路径, state, 'utf-8')
      console.log(`\n[REPL] 状态已保存至: ${状态文件路径}`)
    } else {
      console.log('\n[REPL] 未配置状态文件路径，无法保存。')
    }
  }

  let 解析命令 = (userInput: string): { 动作: '放行' | '拦截' | '打回'; 内容: string } | null => {
    userInput = userInput.trim()
    if (userInput === '') return { 动作: '放行', 内容: '' }
    if (userInput.startsWith('/edit')) return { 动作: '拦截', 内容: userInput.replace(/^\/edit\s*/, '') }
    if (userInput.startsWith('/reject')) return { 动作: '打回', 内容: userInput.replace(/^\/reject\s*/, '') }
    if (userInput === '/exit') {
      rl.close()
      process.exit(0)
    }
    if (userInput === '/save') return null
    return { 动作: '放行', 内容: '' } // 默认放行
  }

  let hook: 调试拦截钩子 = {}

  let 拦截处理 = async (
    阶段: string,
    工具名称: string,
    详情: string,
  ): Promise<{ 动作: '放行' | '拦截' | '打回'; 内容: string }> => {
    while (true) {
      console.log(`\n============== [REPL 拦截: ${阶段}] ==============`)
      console.log(`AI 正在调用工具: ${工具名称}`)
      console.log(`详情:\n${详情}`)
      console.log(`=================================================`)
      let userInput = await rl.question(
        `[REPL] 请操作 (直接回车放行, /edit <自定义结果>, /reject <拒绝原因>, /save, /exit): `,
      )
      let parsed = 解析命令(userInput)

      if (userInput.trim() === '/save') {
        await 执行保存(选项.消息历史 ?? [])
        continue
      }

      if (parsed !== null) return parsed
    }
  }

  if (拦截策略数组.includes('调用前')) {
    hook.调用前 = async (
      工具名称: string,
      参数: Record<string, unknown>,
    ): Promise<
      { 动作: '放行' } | { 动作: '拦截'; 返回给AI的文本: string } | { 动作: '打回'; 返回给AI的错误信息: string }
    > => {
      let res = await 拦截处理('调用前', 工具名称, JSON.stringify(参数, null, 2))
      switch (res.动作) {
        case '放行':
          return { 动作: '放行' }
        case '拦截':
          return { 动作: '拦截', 返回给AI的文本: res.内容 }
        case '打回':
          return { 动作: '打回', 返回给AI的错误信息: res.内容 }
      }
    }
  }

  if (拦截策略数组.includes('调用后')) {
    hook.调用后 = async (
      工具名称: string,
      参数: Record<string, unknown>,
      结果: Record<string, unknown>,
    ): Promise<
      { 动作: '放行' } | { 动作: '拦截'; 返回给AI的文本: string } | { 动作: '打回'; 返回给AI的错误信息: string }
    > => {
      let res = await 拦截处理(
        '调用后',
        工具名称,
        `【参数】\n${JSON.stringify(参数, null, 2)}\n【真实结果】\n${JSON.stringify(结果, null, 2)}`,
      )
      switch (res.动作) {
        case '放行':
          return { 动作: '放行' }
        case '拦截':
          return { 动作: '拦截', 返回给AI的文本: res.内容 }
        case '打回':
          return { 动作: '打回', 返回给AI的错误信息: res.内容 }
      }
    }
  }

  if (拦截策略数组.includes('出错时')) {
    hook.出错时 = async (
      工具名称: string,
      参数: string | Record<string, unknown>,
      错误信息: string,
    ): Promise<
      { 动作: '放行' } | { 动作: '拦截'; 返回给AI的文本: string } | { 动作: '打回'; 返回给AI的错误信息: string }
    > => {
      let 参数字符串 = typeof 参数 === 'string' ? 参数 : JSON.stringify(参数, null, 2)
      let res = await 拦截处理('出错时', 工具名称, `【参数】\n${参数字符串}\n【错误信息】\n${错误信息}`)
      switch (res.动作) {
        case '放行':
          return { 动作: '放行' }
        case '拦截':
          return { 动作: '拦截', 返回给AI的文本: res.内容 }
        case '打回':
          return { 动作: '打回', 返回给AI的错误信息: res.内容 }
      }
    }
  }

  选项.调试Hook = hook

  let 原始回调 = 选项.回调
  选项.回调 = async (事件: 智能体事件): Promise<void> => {
    if (事件.类型 === '原始AI返回' && 自动保存 === true) {
      let 假消息列表 = [...事件.当前消息列表]
      let assistant消息: 智能体消息类型 = {
        role: 'assistant',
        content: 事件.完整文本 !== '' ? 事件.完整文本 : null,
        tool_calls: 事件.工具调用列表.map((调用) => ({
          id: 调用.id,
          type: 'function',
          function: { name: 调用.名称, arguments: 调用.参数片段 },
        })),
      }
      假消息列表.push(assistant消息)

      if (状态文件路径 !== undefined) {
        let state = await 智能体实例.导出完整状态(假消息列表)
        fs.writeFileSync(状态文件路径, state, 'utf-8')
      }
    }
    await 原始回调(事件)
  }

  try {
    while (true) {
      let 命令文本 = 选项.命令.trim()
      if (命令文本 === '/exit') {
        break
      }
      if (命令文本 === '/save') {
        await 执行保存(选项.消息历史 ?? [])
        选项.命令 = await rl.question('\n[REPL] 请输入指令 (或输入 /save, /exit): ')
        continue
      }
      if (命令文本 === '') {
        选项.命令 = await rl.question('\n[REPL] 请输入指令 (或输入 /save, /exit): ')
        continue
      }

      let 结果 = await 智能体实例.对话(选项)
      console.log('\n======================================')
      console.log('测试结束原因:', 结果.结束原因)

      选项.消息历史 = 结果.消息列表

      let userInput = ''
      while (true) {
        userInput = await rl.question('\n[REPL] 请输入下一轮指令 (直接输入内容，或 /exit, /save): ')
        if (userInput.trim().toLowerCase() === '/save') {
          await 执行保存(选项.消息历史 ?? [])
        } else {
          break
        }
      }
      选项.命令 = userInput
    }
  } finally {
    rl.close()
  }
}
