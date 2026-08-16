import { z } from 'zod'
import { 智能体工具 } from '../../agent/types'
import {
  删除动态工具核心,
  更新动态工具核心,
  查看动态工具代码核心,
  注册动态工具核心,
  调用动态工具核心,
  type 动态工具上下文,
} from './dynamic-tool-api'

export function 创建动态工具工具(上下文: 动态工具上下文): 智能体工具 {
  return 智能体工具.创建({
    名称: 'create_dynamic_tool',
    描述:
      '创建一个新的动态工具并持久化到工具库中。你需要编写一段纯 JavaScript 代码来定义工具。' +
      '代码中必须声明一个名为「工具」的变量，包含以下字段: 名称(string)、描述(string)、参数Schema(object, 标准 JSON Schema 格式)、返回值Schema(object, 标准 JSON Schema 格式)、实现(async function)。' +
      '代码在严格隔离的沙盒中运行，不能访问网络、文件系统或任何外部资源。' +
      '你必须同时提供一组测试参数，系统会在沙盒中进行冒烟测试，只有测试通过才会入库。' +
      '示例代码:\n' +
      '```\n' +
      '工具 = {\n' +
      '  名称: "calculate_bmi",\n' +
      '  描述: "根据身高体重计算BMI指数",\n' +
      '  参数Schema: {\n' +
      '    type: "object",\n' +
      '    properties: { 身高cm: { type: "number", description: "身高(厘米)" }, 体重kg: { type: "number", description: "体重(千克)" } },\n' +
      '    required: ["身高cm", "体重kg"]\n' +
      '  },\n' +
      '  返回值Schema: {\n' +
      '    type: "object",\n' +
      '    properties: { bmi: { type: "number", description: "BMI指数" }, 等级: { type: "string", description: "体重等级" } },\n' +
      '    required: ["bmi", "等级"]\n' +
      '  },\n' +
      '  实现: async function(参数) {\n' +
      '    let 身高m = 参数.身高cm / 100;\n' +
      '    let bmi = 参数.体重kg / (身高m * 身高m);\n' +
      '    let 等级 = bmi < 18.5 ? "偏瘦" : bmi < 24 ? "正常" : bmi < 28 ? "偏胖" : "肥胖";\n' +
      '    return { bmi: Math.round(bmi * 10) / 10, 等级 };\n' +
      '  }\n' +
      '};\n' +
      '```',
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
    描述: '查看某个已创建的动态工具的完整源代码，便于排查问题或准备二次修改。',
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
    描述: '更新某个已有的动态工具的代码。更新时同样需要提供测试参数进行冒烟测试，测试通过后才会覆盖旧代码。',
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

export function 删除动态工具工具(上下文: 动态工具上下文): 智能体工具 {
  return 智能体工具.创建({
    名称: 'delete_dynamic_tool',
    描述: '永久删除某个动态工具。',
    参数Schema: z.object({ 工具标识: z.string().describe('要删除的工具的 ID 或名称') }),
    返回值Schema: z.object({ 结果: z.enum(['成功', '失败']), 错误信息: z.string().optional() }),
    实现: async (参数: { 工具标识: string }): Promise<{ 结果: '成功' | '失败'; 错误信息?: string }> => {
      return await 删除动态工具核心(上下文, 参数)
    },
  })
}

export function 调用动态工具工具(上下文: 动态工具上下文): 智能体工具 {
  return 智能体工具.创建({
    名称: 'call_dynamic_tool',
    描述: '调用一个已创建的动态工具。参数格式与原生工具调用一致：传入工具名称和 JSON 格式的参数字符串。',
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
