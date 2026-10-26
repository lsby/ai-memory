import { z } from 'zod'
import { 智能体工具 } from '../../agent/types'
import {
  更新动态工具核心,
  查看动态工具代码核心,
  注册动态工具核心,
  移除动态工具核心,
  调用动态工具核心,
  type 动态工具上下文,
} from './dynamic-tool-api'

export function 创建动态工具工具(上下文: 动态工具上下文): 智能体工具 {
  return 智能体工具.创建({
    名称: 'create_dynamic_tool',
    描述: '',
    参数Schema: z.object({
      代码: z.string().describe('符合规范的纯 JavaScript 代码字符串'),
      测试参数_json: z.string().describe('用于冒烟测试的参数 JSON 字符串，必须符合工具定义的参数结构'),
    }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      id: z.string().optional(),
      工具名称: z.string().optional(),
      测试执行输出: z.string().optional(),
      错误信息: z.string().optional(),
    }),
    实现: async (参数: {
      代码: string
      测试参数_json: string
    }): Promise<{
      结果: '成功' | '失败'
      id?: string
      工具名称?: string
      测试执行输出?: string
      错误信息?: string
    }> => {
      return await 注册动态工具核心(上下文, 参数)
    },
  })
}

export function 查看动态工具代码工具(上下文: 动态工具上下文): 智能体工具 {
  return 智能体工具.创建({
    名称: 'view_dynamic_tool_code',
    描述: '',
    参数Schema: z.object({ 工具标识: z.string().describe('工具的 ID 或名称') }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      id: z.string().optional(),
      名称: z.string().optional(),
      描述: z.string().optional(),
      代码: z.string().optional(),
      错误信息: z.string().optional(),
    }),
    实现: async (参数: {
      工具标识: string
    }): Promise<{
      结果: '成功' | '失败'
      id?: string
      名称?: string
      描述?: string
      代码?: string
      错误信息?: string
    }> => {
      return await 查看动态工具代码核心(上下文, 参数)
    },
  })
}

export function 更新动态工具工具(上下文: 动态工具上下文): 智能体工具 {
  return 智能体工具.创建({
    名称: 'update_dynamic_tool',
    描述: '',
    参数Schema: z.object({
      工具标识: z.string().describe('要更新的工具的 ID 或名称'),
      新代码: z.string().describe('新的工具代码'),
      测试参数_json: z.string().describe('用于冒烟测试的参数 JSON 字符串'),
    }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      测试执行输出: z.string().optional(),
      错误信息: z.string().optional(),
    }),
    实现: async (参数: {
      工具标识: string
      新代码: string
      测试参数_json: string
    }): Promise<{ 结果: '成功' | '失败'; 测试执行输出?: string; 错误信息?: string }> => {
      return await 更新动态工具核心(上下文, 参数)
    },
  })
}

export function 移除动态工具工具(上下文: 动态工具上下文): 智能体工具 {
  return 智能体工具.创建({
    名称: 'remove_dynamic_tool',
    描述: '',
    参数Schema: z.object({ 工具标识: z.string().describe('要删除的工具的 ID 或名称') }),
    返回值Schema: z.object({ 结果: z.enum(['成功', '失败']), 错误信息: z.string().optional() }),
    实现: async (参数: { 工具标识: string }): Promise<{ 结果: '成功' | '失败'; 错误信息?: string }> => {
      return await 移除动态工具核心(上下文, 参数)
    },
  })
}

export function 调用动态工具工具(上下文: 动态工具上下文): 智能体工具 {
  return 智能体工具.创建({
    名称: 'call_dynamic_tool',
    描述: '',
    参数Schema: z.object({
      name: z.string().describe('要调用的动态工具的名称'),
      arguments: z.string().describe('传给工具的参数，JSON 字符串格式'),
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
      return await 调用动态工具核心(上下文, 参数)
    },
  })
}
