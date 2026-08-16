import { jsonrepair } from 'jsonrepair'
import { Kysely } from 'kysely'
import { randomUUID } from 'node:crypto'
import { 智能体事件 } from '../../agent/types'
import { 内部带记忆的智能体配置, 记忆数据库 } from '../agent-memory-types'
import { 加载并校验动态工具, 在沙盒中执行工具 } from '../dynamic-tool-loader'

export type 动态工具上下文 = {
  数据库查询器: Kysely<记忆数据库>
  获取向量: (内容: string) => Promise<number[] | null>
  配置: 内部带记忆的智能体配置
  回调?: ((事件: 智能体事件) => Promise<void>) | undefined
}

export async function 注册动态工具核心(
  上下文: 动态工具上下文,
  参数: { 代码: string; 测试参数_json: string },
): Promise<{ 结果: '成功' | '失败'; id?: string; 工具名称?: string; 测试执行输出?: string; 错误信息?: string }> {
  let { 数据库查询器, 获取向量, 回调 } = 上下文

  try {
    try {
      JSON.parse(参数.测试参数_json)
    } catch (_e: unknown) {
      try {
        参数.测试参数_json = jsonrepair(参数.测试参数_json)
        JSON.parse(参数.测试参数_json)
      } catch (_e2: unknown) {
        return {
          结果: '失败',
          错误信息: `参数格式错误：测试参数_json 不是合法的 JSON 字符串，且自动修复失败。请检查格式后重试。`,
        }
      }
    }

    let 加载结果 = await 加载并校验动态工具(参数.代码)
    if (加载结果.成功 === false) {
      return { 结果: '失败', 错误信息: `代码校验失败: ${加载结果.错误信息}` }
    }

    let 已有工具 = await 数据库查询器
      .selectFrom('动态工具表')
      .select('id')
      .where('名称', '=', 加载结果.工具.名称)
      .executeTakeFirst()
    if (已有工具 !== undefined) {
      return { 结果: '失败', 错误信息: `名称「${加载结果.工具.名称}」已存在，请使用其他名称或更新已有工具` }
    }

    let 测试输出: string
    try {
      测试输出 = await 在沙盒中执行工具(参数.代码, 参数.测试参数_json)
    } catch (测试错误: unknown) {
      return {
        结果: '失败',
        错误信息: `冒烟测试失败: ${String(测试错误 instanceof Error ? (测试错误.stack ?? 测试错误.message) : 测试错误)}`,
      }
    }

    let 向量文本 = `${加载结果.工具.名称} ${加载结果.工具.描述}`
    let 向量 = await 获取向量(向量文本)

    let id = randomUUID()
    await 数据库查询器
      .insertInto('动态工具表')
      .values({
        id,
        名称: 加载结果.工具.名称,
        描述: 加载结果.工具.描述,
        代码: 参数.代码,
        向量: 向量 !== null ? JSON.stringify(向量) : null,
        向量维度: 向量 !== null ? 向量.length : null,
        创建时间: new Date(),
      })
      .execute()

    if (回调 !== undefined) {
      await 回调({ 类型: '流程信息', 内容: `[动态工具] 成功创建工具「${加载结果.工具.名称}」(ID: ${id})` })
    }

    return { 结果: '成功', id, 工具名称: 加载结果.工具.名称, 测试执行输出: 测试输出 }
  } catch (error: unknown) {
    return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
  }
}

export async function 查看动态工具代码核心(
  上下文: 动态工具上下文,
  参数: { 工具标识: string },
): Promise<{ 结果: '成功' | '失败'; id?: string; 名称?: string; 描述?: string; 代码?: string; 错误信息?: string }> {
  let { 数据库查询器 } = 上下文

  try {
    let 工具记录 = await 数据库查询器
      .selectFrom('动态工具表')
      .selectAll()
      .where((eb) => eb.or([eb('id', '=', 参数.工具标识), eb('名称', '=', 参数.工具标识)]))
      .executeTakeFirst()

    if (工具记录 === undefined) {
      return { 结果: '失败', 错误信息: `未找到标识为「${参数.工具标识}」的动态工具` }
    }

    return { 结果: '成功', id: 工具记录.id, 名称: 工具记录.名称, 描述: 工具记录.描述, 代码: 工具记录.代码 }
  } catch (error: unknown) {
    return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
  }
}

export async function 更新动态工具核心(
  上下文: 动态工具上下文,
  参数: { 工具标识: string; 新代码: string; 测试参数_json: string },
): Promise<{ 结果: '成功' | '失败'; 测试执行输出?: string; 错误信息?: string }> {
  let { 数据库查询器, 获取向量, 回调 } = 上下文

  try {
    try {
      JSON.parse(参数.测试参数_json)
    } catch (_e: unknown) {
      try {
        参数.测试参数_json = jsonrepair(参数.测试参数_json)
        JSON.parse(参数.测试参数_json)
      } catch (_e2: unknown) {
        return {
          结果: '失败',
          错误信息: `参数格式错误：测试参数_json 不是合法的 JSON 字符串，且自动修复失败。请检查格式后重试。`,
        }
      }
    }

    let 已有工具 = await 数据库查询器
      .selectFrom('动态工具表')
      .select(['id', '名称'])
      .where((eb) => eb.or([eb('id', '=', 参数.工具标识), eb('名称', '=', 参数.工具标识)]))
      .executeTakeFirst()
    if (已有工具 === undefined) {
      return { 结果: '失败', 错误信息: `未找到标识为「${参数.工具标识}」的动态工具` }
    }

    let 加载结果 = await 加载并校验动态工具(参数.新代码)
    if (加载结果.成功 === false) {
      return { 结果: '失败', 错误信息: `新代码校验失败: ${加载结果.错误信息}` }
    }

    if (加载结果.工具.名称 !== 已有工具.名称) {
      let 重名工具 = await 数据库查询器
        .selectFrom('动态工具表')
        .select('id')
        .where('名称', '=', 加载结果.工具.名称)
        .executeTakeFirst()
      if (重名工具 !== undefined) {
        return { 结果: '失败', 错误信息: `更新失败: 新代码中的名称「${加载结果.工具.名称}」已被其他工具占用` }
      }
    }

    let 测试输出: string
    try {
      测试输出 = await 在沙盒中执行工具(参数.新代码, 参数.测试参数_json)
    } catch (测试错误: unknown) {
      return {
        结果: '失败',
        错误信息: `冒烟测试失败: ${String(测试错误 instanceof Error ? (测试错误.stack ?? 测试错误.message) : 测试错误)}`,
      }
    }

    let 向量文本 = `${加载结果.工具.名称} ${加载结果.工具.描述}`
    let 向量 = await 获取向量(向量文本)

    await 数据库查询器
      .updateTable('动态工具表')
      .set({
        名称: 加载结果.工具.名称,
        描述: 加载结果.工具.描述,
        代码: 参数.新代码,
        向量: 向量 !== null ? JSON.stringify(向量) : null,
        向量维度: 向量 !== null ? 向量.length : null,
      })
      .where('id', '=', 已有工具.id)
      .execute()

    if (回调 !== undefined) {
      await 回调({ 类型: '流程信息', 内容: `[动态工具] 成功更新工具「${加载结果.工具.名称}」(ID: ${已有工具.id})` })
    }

    return { 结果: '成功', 测试执行输出: 测试输出 }
  } catch (error: unknown) {
    return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
  }
}

export async function 删除动态工具核心(
  上下文: 动态工具上下文,
  参数: { 工具标识: string },
): Promise<{ 结果: '成功' | '失败'; 错误信息?: string }> {
  let { 数据库查询器, 回调 } = 上下文

  try {
    let 已有工具 = await 数据库查询器
      .selectFrom('动态工具表')
      .select(['id', '名称'])
      .where((eb) => eb.or([eb('id', '=', 参数.工具标识), eb('名称', '=', 参数.工具标识)]))
      .executeTakeFirst()
    if (已有工具 === undefined) {
      return { 结果: '失败', 错误信息: `未找到标识为「${参数.工具标识}」的动态工具` }
    }

    await 数据库查询器.deleteFrom('动态工具表').where('id', '=', 已有工具.id).execute()

    if (回调 !== undefined) {
      await 回调({ 类型: '流程信息', 内容: `[动态工具] 成功删除工具「${已有工具.名称}」(ID: ${已有工具.id})` })
    }

    return { 结果: '成功' }
  } catch (error: unknown) {
    return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
  }
}

export async function 调用动态工具核心(
  上下文: 动态工具上下文,
  参数: { name: string; arguments: string },
): Promise<{ 结果: '成功' | '失败'; 执行输出?: string; 错误信息?: string }> {
  let { 数据库查询器, 回调 } = 上下文

  try {
    let 工具记录 = await 数据库查询器
      .selectFrom('动态工具表')
      .select(['id', '名称', '代码'])
      .where('名称', '=', 参数.name)
      .executeTakeFirst()

    if (工具记录 === undefined) {
      return { 结果: '失败', 错误信息: `未找到名称为「${参数.name}」的动态工具` }
    }

    try {
      JSON.parse(参数.arguments)
    } catch (_e: unknown) {
      try {
        参数.arguments = jsonrepair(参数.arguments)
        JSON.parse(参数.arguments)
      } catch (_e2: unknown) {
        return {
          结果: '失败',
          错误信息: `参数格式错误：arguments 不是合法的 JSON 字符串，且自动修复失败。请检查格式后重试。`,
        }
      }
    }

    if (回调 !== undefined) {
      await 回调({ 类型: '流程信息', 内容: `[动态工具] 正在沙盒中执行工具「${工具记录.名称}」...` })
    }

    let 加载结果 = await 加载并校验动态工具(工具记录.代码)
    if (加载结果.成功 === false) {
      return { 结果: '失败', 错误信息: `动态工具代码校验失败: ${加载结果.错误信息}` }
    }

    let 执行结果 = await 在沙盒中执行工具(
      工具记录.代码,
      参数.arguments,
      加载结果.工具.参数Schema,
      加载结果.工具.返回值Schema,
    )

    if (回调 !== undefined) {
      await 回调({ 类型: '流程信息', 内容: `[动态工具] 工具「${工具记录.名称}」执行完成` })
    }

    return { 结果: '成功', 执行输出: 执行结果 }
  } catch (error: unknown) {
    return {
      结果: '失败',
      错误信息: `执行出错: ${String(error instanceof Error ? (error.stack ?? error.message) : error)}`,
    }
  }
}
