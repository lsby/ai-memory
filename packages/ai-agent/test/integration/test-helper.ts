import OpenAI from 'openai'

export let apiKey = process.env['AI_KEY'] ?? ''
export let baseURL = process.env['AI_BASE_URL'] ?? ''
export let model = process.env['AI_MODEL'] ?? ''

export function 检查环境变量(): void {
  if (apiKey === '' || baseURL === '' || model === '') {
    console.error('请设置环境变量: AI_KEY, AI_BASE_URL, AI_MODEL')
    process.exit(1)
  }
}

export function 创建客户端(): OpenAI {
  return new OpenAI({ apiKey, baseURL })
}
