import { z } from 'zod'
import { 智能体工具 } from '../../agent/types'
import { 创建技能核心, 执行技能核心, 更新技能核心, 查看技能代码核心, 移除技能核心, type 技能上下文 } from './skill-api'

export function 创建技能工具(上下文: 技能上下文): 智能体工具 {
  return 智能体工具.创建({
    名称: 'create_skill',
    描述: '',
    参数Schema: z.object({
      代码: z.string().describe('符合规范的纯 JavaScript 代码字符串'),
      测试参数_json: z.string().describe('用于冒烟测试的参数 JSON 字符串，必须符合技能定义的参数结构'),
      线索: z.array(z.string().trim().min(1)).describe('能够联想到这个技能的自然语言线索'),
    }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      id: z.string().optional(),
      技能名称: z.string().optional(),
      测试执行输出: z.string().optional(),
      错误信息: z.string().optional(),
    }),
    实现: async (参数: {
      代码: string
      测试参数_json: string
      线索: string[]
    }): Promise<{
      结果: '成功' | '失败'
      id?: string
      技能名称?: string
      测试执行输出?: string
      错误信息?: string
    }> => {
      return await 创建技能核心(上下文, 参数)
    },
  })
}

export function 查看技能代码工具(上下文: 技能上下文): 智能体工具 {
  return 智能体工具.创建({
    名称: 'view_skill_code',
    描述: '',
    参数Schema: z.object({ 技能标识: z.string().describe('技能的 ID 或名称') }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      id: z.string().optional(),
      名称: z.string().optional(),
      描述: z.string().optional(),
      代码: z.string().optional(),
      线索: z.array(z.string()).optional(),
      错误信息: z.string().optional(),
    }),
    实现: async (参数: {
      技能标识: string
    }): Promise<{
      结果: '成功' | '失败'
      id?: string
      名称?: string
      描述?: string
      代码?: string
      线索?: string[]
      错误信息?: string
    }> => {
      return await 查看技能代码核心(上下文, 参数)
    },
  })
}

export function 更新技能工具(上下文: 技能上下文): 智能体工具 {
  return 智能体工具.创建({
    名称: 'update_skill',
    描述: '',
    参数Schema: z.object({
      技能标识: z.string().describe('要更新的技能的 ID 或名称'),
      新代码: z.string().describe('新的技能代码'),
      测试参数_json: z.string().describe('用于冒烟测试的参数 JSON 字符串'),
      线索: z.array(z.string().trim().min(1)).describe('更新后能够联想到这个技能的自然语言线索'),
    }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      测试执行输出: z.string().optional(),
      错误信息: z.string().optional(),
    }),
    实现: async (参数: {
      技能标识: string
      新代码: string
      测试参数_json: string
      线索: string[]
    }): Promise<{ 结果: '成功' | '失败'; 测试执行输出?: string; 错误信息?: string }> => {
      return await 更新技能核心(上下文, 参数)
    },
  })
}

export function 移除技能工具(上下文: 技能上下文): 智能体工具 {
  return 智能体工具.创建({
    名称: 'remove_skill',
    描述: '',
    参数Schema: z.object({ 技能标识: z.string().describe('要删除的技能的 ID 或名称') }),
    返回值Schema: z.object({ 结果: z.enum(['成功', '失败']), 错误信息: z.string().optional() }),
    实现: async (参数: { 技能标识: string }): Promise<{ 结果: '成功' | '失败'; 错误信息?: string }> => {
      return await 移除技能核心(上下文, 参数)
    },
  })
}

export function 执行技能工具(上下文: 技能上下文): 智能体工具 {
  return 智能体工具.创建({
    名称: 'execute_skill',
    描述: '',
    参数Schema: z.object({
      name: z.string().describe('要调用的技能的名称'),
      arguments: z.string().describe('传给技能的参数，JSON 字符串格式'),
    }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      执行输出: z.string().optional(),
      错误信息: z.string().optional(),
    }),
    实现: async (参数: {
      name: string
      arguments: string
    }): Promise<{ 结果: '成功' | '失败'; 执行输出?: string; 错误信息?: string }> => {
      return await 执行技能核心(上下文, 参数)
    },
  })
}
