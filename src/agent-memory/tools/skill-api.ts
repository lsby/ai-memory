import { jsonrepair } from 'jsonrepair'
import { Kysely } from 'kysely'
import { randomUUID } from 'node:crypto'
import { 智能体事件 } from '../../agent/types'
import { 同步技能线索, 清理孤立线索, 生成技能所需向量文本, 读取技能线索映射 } from '../storage/clue-storage'
import { 内部带记忆的智能体配置, 记忆数据库 } from '../types'
import { 加载并校验技能, 在沙盒中执行技能 } from './skill-loader'

export type 技能上下文 = {
  数据库查询器: Kysely<记忆数据库>
  获取向量: (内容: string) => Promise<number[] | null>
  配置: 内部带记忆的智能体配置
  回调?: ((事件: 智能体事件) => Promise<void>) | undefined
}

/** 技能入库时需要提前计算的全部向量文本；代码校验不过时返回空数组。 */
export async function 提取技能向量文本(代码: string, 线索: string[]): Promise<string[]> {
  try {
    let 加载结果 = await 加载并校验技能(代码)
    return 加载结果.成功 === true ? 生成技能所需向量文本(加载结果.技能.名称, 加载结果.技能.描述, 线索) : []
  } catch (_错误: unknown) {
    return []
  }
}

export async function 创建技能核心(
  上下文: 技能上下文,
  参数: { 代码: string; 测试参数_json: string; 线索: string[] },
): Promise<{ 结果: '成功' | '失败'; id?: string; 技能名称?: string; 测试执行输出?: string; 错误信息?: string }> {
  let { 数据库查询器, 获取向量, 回调, 配置 } = 上下文

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
          错误信息: 配置.模型语言包.技能参数JSON错误('test_arguments_json'),
        }
      }
    }

    let 加载结果 = await 加载并校验技能(参数.代码, 配置.模型语言包)
    if (加载结果.成功 === false) {
      return { 结果: '失败', 错误信息: 配置.模型语言包.技能代码校验失败(加载结果.错误信息) }
    }

    let 已有技能 = await 数据库查询器
      .selectFrom('当前技能表')
      .select('id')
      .where('名称', '=', 加载结果.技能.名称)
      .executeTakeFirst()
    if (已有技能 !== undefined) {
      return { 结果: '失败', 错误信息: 配置.模型语言包.技能名称已存在(加载结果.技能.名称) }
    }

    let 测试输出: string
    try {
      测试输出 = await 在沙盒中执行技能(参数.代码, 参数.测试参数_json, undefined, undefined, 配置.模型语言包)
    } catch (测试错误: unknown) {
      return {
        结果: '失败',
        错误信息: 配置.模型语言包.技能冒烟测试失败(
          String(测试错误 instanceof Error ? (测试错误.stack ?? 测试错误.message) : 测试错误),
        ),
      }
    }

    let 向量文本 = `${加载结果.技能.名称} ${加载结果.技能.描述}`
    let 向量 = await 获取向量(向量文本)

    let id = randomUUID()
    await 数据库查询器
      .insertInto('当前技能表')
      .values({
        id,
        名称: 加载结果.技能.名称,
        描述: 加载结果.技能.描述,
        代码: 参数.代码,
        向量: 向量 !== null ? JSON.stringify(向量) : null,
        向量维度: 向量 !== null ? 向量.length : null,
        创建时间: new Date(),
      })
      .execute()
    await 同步技能线索(上下文, id, 加载结果.技能.名称, 加载结果.技能.描述, 参数.线索)

    if (回调 !== undefined) {
      await 回调({ 类型: '流程信息', 内容: `[技能] 成功创建技能「${加载结果.技能.名称}」(ID: ${id})` })
    }

    return { 结果: '成功', id, 技能名称: 加载结果.技能.名称, 测试执行输出: 测试输出 }
  } catch (error: unknown) {
    return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
  }
}

export async function 查看技能代码核心(
  上下文: 技能上下文,
  参数: { 技能标识: string },
): Promise<{
  结果: '成功' | '失败'
  id?: string
  名称?: string
  描述?: string
  代码?: string
  线索?: string[]
  错误信息?: string
}> {
  let { 数据库查询器, 配置 } = 上下文

  try {
    let 技能记录 = await 数据库查询器
      .selectFrom('当前技能表')
      .selectAll()
      .where((eb) => eb.or([eb('id', '=', 参数.技能标识), eb('名称', '=', 参数.技能标识)]))
      .executeTakeFirst()

    if (技能记录 === undefined) {
      return { 结果: '失败', 错误信息: 配置.模型语言包.未找到技能('标识', 参数.技能标识) }
    }

    let 线索映射 = await 读取技能线索映射(数据库查询器, [技能记录.id])
    return {
      结果: '成功',
      id: 技能记录.id,
      名称: 技能记录.名称,
      描述: 技能记录.描述,
      代码: 技能记录.代码,
      线索: 线索映射.get(技能记录.id) ?? [],
    }
  } catch (error: unknown) {
    return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
  }
}

export async function 更新技能核心(
  上下文: 技能上下文,
  参数: { 技能标识: string; 新代码: string; 测试参数_json: string; 线索: string[] },
): Promise<{ 结果: '成功' | '失败'; 测试执行输出?: string; 错误信息?: string }> {
  let { 数据库查询器, 获取向量, 回调, 配置 } = 上下文

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
          错误信息: 配置.模型语言包.技能参数JSON错误('test_arguments_json'),
        }
      }
    }

    let 已有技能 = await 数据库查询器
      .selectFrom('当前技能表')
      .select(['id', '名称'])
      .where((eb) => eb.or([eb('id', '=', 参数.技能标识), eb('名称', '=', 参数.技能标识)]))
      .executeTakeFirst()
    if (已有技能 === undefined) {
      return { 结果: '失败', 错误信息: 配置.模型语言包.未找到技能('标识', 参数.技能标识) }
    }

    let 加载结果 = await 加载并校验技能(参数.新代码, 配置.模型语言包)
    if (加载结果.成功 === false) {
      return { 结果: '失败', 错误信息: 配置.模型语言包.技能新代码校验失败(加载结果.错误信息) }
    }

    if (加载结果.技能.名称 !== 已有技能.名称) {
      let 重名技能 = await 数据库查询器
        .selectFrom('当前技能表')
        .select('id')
        .where('名称', '=', 加载结果.技能.名称)
        .executeTakeFirst()
      if (重名技能 !== undefined) {
        return { 结果: '失败', 错误信息: 配置.模型语言包.技能更新名称冲突(加载结果.技能.名称) }
      }
    }

    let 测试输出: string
    try {
      测试输出 = await 在沙盒中执行技能(参数.新代码, 参数.测试参数_json, undefined, undefined, 配置.模型语言包)
    } catch (测试错误: unknown) {
      return {
        结果: '失败',
        错误信息: 配置.模型语言包.技能冒烟测试失败(
          String(测试错误 instanceof Error ? (测试错误.stack ?? 测试错误.message) : 测试错误),
        ),
      }
    }

    let 向量文本 = `${加载结果.技能.名称} ${加载结果.技能.描述}`
    let 向量 = await 获取向量(向量文本)

    await 数据库查询器
      .updateTable('当前技能表')
      .set({
        名称: 加载结果.技能.名称,
        描述: 加载结果.技能.描述,
        代码: 参数.新代码,
        向量: 向量 !== null ? JSON.stringify(向量) : null,
        向量维度: 向量 !== null ? 向量.length : null,
      })
      .where('id', '=', 已有技能.id)
      .execute()
    await 同步技能线索(上下文, 已有技能.id, 加载结果.技能.名称, 加载结果.技能.描述, 参数.线索)

    if (回调 !== undefined) {
      await 回调({ 类型: '流程信息', 内容: `[技能] 成功更新技能「${加载结果.技能.名称}」(ID: ${已有技能.id})` })
    }

    return { 结果: '成功', 测试执行输出: 测试输出 }
  } catch (error: unknown) {
    return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
  }
}

export async function 移除技能核心(
  上下文: 技能上下文,
  参数: { 技能标识: string },
): Promise<{ 结果: '成功' | '失败'; 错误信息?: string }> {
  let { 数据库查询器, 回调, 配置 } = 上下文

  try {
    let 已有技能 = await 数据库查询器
      .selectFrom('当前技能表')
      .select(['id', '名称'])
      .where((eb) => eb.or([eb('id', '=', 参数.技能标识), eb('名称', '=', 参数.技能标识)]))
      .executeTakeFirst()
    if (已有技能 === undefined) {
      return { 结果: '失败', 错误信息: 配置.模型语言包.未找到技能('标识', 参数.技能标识) }
    }

    await 数据库查询器.deleteFrom('当前技能线索关联表').where('技能id', '=', 已有技能.id).execute()
    await 数据库查询器.deleteFrom('当前技能表').where('id', '=', 已有技能.id).execute()
    await 清理孤立线索(数据库查询器)

    if (回调 !== undefined) {
      await 回调({ 类型: '流程信息', 内容: `[技能] 成功删除技能「${已有技能.名称}」(ID: ${已有技能.id})` })
    }

    return { 结果: '成功' }
  } catch (error: unknown) {
    return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
  }
}

export async function 执行技能核心(
  上下文: 技能上下文,
  参数: { name: string; arguments: string },
): Promise<{ 结果: '成功' | '失败'; 执行输出?: string; 错误信息?: string }> {
  let { 数据库查询器, 回调, 配置 } = 上下文

  try {
    let 技能记录 = await 数据库查询器
      .selectFrom('当前技能表')
      .select(['id', '名称', '代码'])
      .where('名称', '=', 参数.name)
      .executeTakeFirst()

    if (技能记录 === undefined) {
      return { 结果: '失败', 错误信息: 配置.模型语言包.未找到技能('名称', 参数.name) }
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
          错误信息: 配置.模型语言包.技能参数JSON错误('arguments'),
        }
      }
    }

    if (回调 !== undefined) {
      await 回调({ 类型: '流程信息', 内容: `[技能] 正在沙盒中执行技能「${技能记录.名称}」...` })
    }

    let 加载结果 = await 加载并校验技能(技能记录.代码, 配置.模型语言包)
    if (加载结果.成功 === false) {
      return { 结果: '失败', 错误信息: 配置.模型语言包.技能代码校验失败(加载结果.错误信息) }
    }

    let 执行结果 = await 在沙盒中执行技能(
      技能记录.代码,
      参数.arguments,
      加载结果.技能.参数Schema,
      加载结果.技能.返回值Schema,
      配置.模型语言包,
    )

    if (回调 !== undefined) {
      await 回调({ 类型: '流程信息', 内容: `[技能] 技能「${技能记录.名称}」执行完成` })
    }

    return { 结果: '成功', 执行输出: 执行结果 }
  } catch (error: unknown) {
    return {
      结果: '失败',
      错误信息: 配置.模型语言包.技能执行出错(String(error instanceof Error ? (error.stack ?? error.message) : error)),
    }
  }
}
