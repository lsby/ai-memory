import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline/promises'

export type 包信息 = {
  名称: string
  短名称: string
  版本: string
  目录: string
  清单路径: string
  内部依赖: string[]
}

export type 命令结果 = {
  退出码: number
  标准输出: string
  标准错误: string
}

export type 交互选项<T> = {
  标签: string
  值: T
}

function 解析命令可执行名(命令: string): string {
  if (process.platform === 'win32' && (命令 === 'pnpm' || 命令 === 'npm' || 命令 === 'npx')) {
    return `${命令}.cmd`
  }
  return 命令
}

export function 执行命令(
  命令: string,
  参数: string[],
  工作目录: string
): Promise<命令结果> {
  return new Promise((resolve, reject) => {
    let 可执行名 = 解析命令可执行名(命令)
    let 子进程 = spawn(可执行名, 参数, {
      cwd: 工作目录,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })

    let 标准输出 = ''
    let 标准错误 = ''

    子进程.stdout.on('data', (chunk: Buffer) => {
      标准输出 += chunk.toString('utf8')
    })

    子进程.stderr.on('data', (chunk: Buffer) => {
      标准错误 += chunk.toString('utf8')
    })

    子进程.on('error', (err: Error) => {
      reject(err)
    })

    子进程.on('close', (code: number | null) => {
      resolve({
        退出码: code ?? 1,
        标准输出: 标准输出.trim(),
        标准错误: 标准错误.trim(),
      })
    })
  })
}

export function 执行命令继承输出(
  命令: string,
  参数: string[],
  工作目录: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    let 可执行名 = 解析命令可执行名(命令)
    let 子进程 = spawn(可执行名, 参数, {
      cwd: 工作目录,
      stdio: 'inherit',
      shell: false,
    })

    子进程.on('error', (err: Error) => {
      reject(err)
    })

    子进程.on('close', (code: number | null) => {
      resolve(code ?? 1)
    })
  })
}

function 提取内部依赖(
  原始依赖: unknown,
  工作区包名集合: Set<string>
): string[] {
  if (typeof 原始依赖 !== 'object' || 原始依赖 === null) {
    return []
  }

  let 结果: string[] = []
  for (let [包名, 版本范围] of Object.entries(原始依赖)) {
    if (
      工作区包名集合.has(包名) &&
      typeof 版本范围 === 'string' &&
      版本范围.startsWith('workspace:')
    ) {
      结果.push(包名)
    }
  }
  return 结果
}

function 去掉Scope(包名: string): string {
  let 斜杠索引 = 包名.indexOf('/')
  if (斜杠索引 >= 0) {
    return 包名.slice(斜杠索引 + 1)
  }
  return 包名
}

export async function 扫描工作区包(根目录: string): Promise<包信息[]> {
  let packages目录 = path.join(根目录, 'packages')
  let 条目列表 = await fs.readdir(packages目录, { withFileTypes: true })

  let 原始清单列表: Array<{
    目录: string
    清单路径: string
    名称: string
    版本: string
    dependencies: unknown
    peerDependencies: unknown
  }> = []

  for (let 条目 of 条目列表) {
    if (!条目.isDirectory()) {
      continue
    }
    let 包目录 = path.join(packages目录, 条目.name)
    let 清单路径 = path.join(包目录, 'package.json')
    let 内容: string
    try {
      内容 = await fs.readFile(清单路径, 'utf8')
    } catch {
      continue
    }

    let 解析结果: unknown = JSON.parse(内容)
    if (typeof 解析结果 !== 'object' || 解析结果 === null) {
      continue
    }
    let 清单 = 解析结果 as Record<string, unknown>
    if (typeof 清单['name'] !== 'string' || typeof 清单['version'] !== 'string') {
      continue
    }
    if (清单['private'] === true) {
      continue
    }

    原始清单列表.push({
      目录: 包目录,
      清单路径,
      名称: 清单['name'],
      版本: 清单['version'],
      dependencies: 清单['dependencies'],
      peerDependencies: 清单['peerDependencies'],
    })
  }

  let 包名集合 = new Set<string>(原始清单列表.map((item) => item.名称))
  let 结果: 包信息[] = []

  for (let 项 of 原始清单列表) {
    let 依赖去重 = new Set<string>([
      ...提取内部依赖(项.dependencies, 包名集合),
      ...提取内部依赖(项.peerDependencies, 包名集合),
    ])

    结果.push({
      名称: 项.名称,
      短名称: 去掉Scope(项.名称),
      版本: 项.版本,
      目录: 项.目录,
      清单路径: 项.清单路径,
      内部依赖: Array.from(依赖去重),
    })
  }

  return 结果
}

export function 查找包(所有包: 包信息[], 输入名称: string): 包信息 | null {
  let 标准化输入 = 输入名称.trim()
  for (let 包 of 所有包) {
    if (包.名称 === 标准化输入 || 包.短名称 === 标准化输入) {
      return 包
    }
  }
  return null
}

export function 拓扑排序(待排序包: 包信息[]): 包信息[] {
  let 名称到包 = new Map<string, 包信息>()
  for (let 包 of 待排序包) {
    名称到包.set(包.名称, 包)
  }

  let 入度 = new Map<string, number>()
  let 下游映射 = new Map<string, string[]>()

  for (let 包 of 待排序包) {
    入度.set(包.名称, 0)
    下游映射.set(包.名称, [])
  }

  for (let 包 of 待排序包) {
    for (let 依赖名 of 包.内部依赖) {
      if (!名称到包.has(依赖名)) {
        continue
      }
      入度.set(包.名称, (入度.get(包.名称) ?? 0) + 1)
      let 下游 = 下游映射.get(依赖名)
      if (下游 !== undefined) {
        下游.push(包.名称)
      }
    }
  }

  let 队列: string[] = []
  for (let [包名, 度] of 入度.entries()) {
    if (度 === 0) {
      队列.push(包名)
    }
  }

  let 结果: 包信息[] = []
  while (队列.length > 0) {
    let 当前包名 = 队列.shift()
    if (当前包名 === undefined) {
      break
    }
    let 当前包 = 名称到包.get(当前包名)
    if (当前包 !== undefined) {
      结果.push(当前包)
    }

    let 下游列表 = 下游映射.get(当前包名) ?? []
    for (let 下游名 of 下游列表) {
      let 新入度 = (入度.get(下游名) ?? 0) - 1
      入度.set(下游名, 新入度)
      if (新入度 === 0) {
        队列.push(下游名)
      }
    }
  }

  if (结果.length !== 待排序包.length) {
    throw new Error('检测到工作区内部存在循环依赖，无法确定发布顺序')
  }

  return 结果
}

export function 计算关联发布包(所有包: 包信息[], 起始包名: string): 包信息[] {
  let 反向依赖 = new Map<string, string[]>()
  let 名称到包 = new Map<string, 包信息>()

  for (let 包 of 所有包) {
    名称到包.set(包.名称, 包)
    反向依赖.set(包.名称, [])
  }

  for (let 包 of 所有包) {
    for (let 依赖名 of 包.内部依赖) {
      let 列表 = 反向依赖.get(依赖名)
      if (列表 !== undefined) {
        列表.push(包.名称)
      }
    }
  }

  let 已选中 = new Set<string>()
  let 待遍历: string[] = [起始包名]

  while (待遍历.length > 0) {
    let 当前名 = 待遍历.shift()
    if (当前名 === undefined || 已选中.has(当前名)) {
      continue
    }
    已选中.add(当前名)

    let 依赖它的包 = 反向依赖.get(当前名) ?? []
    for (let 下游名 of 依赖它的包) {
      if (!已选中.has(下游名)) {
        待遍历.push(下游名)
      }
    }
  }

  let 选中包列表: 包信息[] = []
  for (let 包 of 所有包) {
    if (已选中.has(包.名称)) {
      选中包列表.push(包)
    }
  }

  return 拓扑排序(选中包列表)
}

type 解析版本结果 = {
  major: number
  minor: number
  patch: number
  prerelease: string
}

function 解析版本(版本: string): 解析版本结果 | null {
  let 匹配 = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(版本.trim())
  if (匹配 === null) {
    return null
  }
  let majorStr = 匹配[1]
  let minorStr = 匹配[2]
  let patchStr = 匹配[3]
  if (majorStr === undefined || minorStr === undefined || patchStr === undefined) {
    return null
  }
  return {
    major: Number(majorStr),
    minor: Number(minorStr),
    patch: Number(patchStr),
    prerelease: 匹配[4] ?? '',
  }
}

export function 比较语义化版本(版本A: string, 版本B: string): number {
  let a = 解析版本(版本A)
  let b = 解析版本(版本B)
  if (a === null || b === null) {
    return 版本A.localeCompare(版本B)
  }

  if (a.major !== b.major) {
    return a.major > b.major ? 1 : -1
  }
  if (a.minor !== b.minor) {
    return a.minor > b.minor ? 1 : -1
  }
  if (a.patch !== b.patch) {
    return a.patch > b.patch ? 1 : -1
  }
  if (a.prerelease === b.prerelease) {
    return 0
  }
  if (a.prerelease === '') {
    return 1
  }
  if (b.prerelease === '') {
    return -1
  }
  return a.prerelease > b.prerelease ? 1 : -1
}

export function 计算下一版本(当前版本: string, 升级方式: string): string | null {
  let 当前 = 解析版本(当前版本)
  if (当前 === null) {
    return null
  }

  let 规范方式 = 升级方式.trim()
  switch (规范方式) {
    case 'patch':
      return `${当前.major}.${当前.minor}.${当前.patch + 1}`
    case 'minor':
      return `${当前.major}.${当前.minor + 1}.0`
    case 'major':
      return `${当前.major + 1}.0.0`
    default: {
      let 目标 = 解析版本(规范方式)
      if (目标 === null) {
        return null
      }
      return 规范方式
    }
  }
}

export async function 检查Git工作区干净与远程同步(
  根目录: string
): Promise<{ 成功: boolean; 错误信息: string }> {
  let 状态结果 = await 执行命令('git', ['status', '--porcelain'], 根目录)
  if (状态结果.退出码 !== 0) {
    return { 成功: false, 错误信息: `检查 Git 状态失败：${状态结果.标准错误}` }
  }
  if (状态结果.标准输出.length > 0) {
    return {
      成功: false,
      错误信息: '工作区不干净，请先提交或清理本地修改后再执行',
    }
  }

  let 拉取结果 = await 执行命令('git', ['fetch', '--quiet'], 根目录)
  if (拉取结果.退出码 !== 0) {
    return {
      成功: false,
      错误信息: `拉取远程状态失败（git fetch）：${拉取结果.标准错误}`,
    }
  }

  let 上游结果 = await 执行命令(
    'git',
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    根目录
  )
  if (上游结果.退出码 !== 0 || 上游结果.标准输出.length === 0) {
    return {
      成功: false,
      错误信息: '当前分支未关联远程跟踪分支，无法校验是否与远程同步',
    }
  }

  let 差异结果 = await 执行命令(
    'git',
    ['rev-list', '--left-right', '--count', 'HEAD...@{u}'],
    根目录
  )
  if (差异结果.退出码 !== 0) {
    return {
      成功: false,
      错误信息: `检查本地与远程分支差异失败：${差异结果.标准错误}`,
    }
  }

  let 计数部分 = 差异结果.标准输出.split(/\s+/)
  let 超前数 = Number(计数部分[0] ?? '0')
  let 落后数 = Number(计数部分[1] ?? '0')

  if (超前数 > 0 || 落后数 > 0) {
    return {
      成功: false,
      错误信息: `本地分支与远程分支未同步（超前 ${超前数} 个提交，落后 ${落后数} 个提交），请先同步后再执行`,
    }
  }

  return { 成功: true, 错误信息: '' }
}

export async function 交互输入(问题: string): Promise<string> {
  let rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    let 回答 = await rl.question(问题)
    return 回答.trim()
  } finally {
    rl.close()
  }
}

export async function 交互确认(问题: string): Promise<boolean> {
  let 回答 = await 交互输入(`${问题} (y/N): `)
  let 小写 = 回答.toLowerCase()
  return 小写 === 'y' || 小写 === 'yes'
}

export async function 交互选择<T>(
  标题: string,
  选项列表: 交互选项<T>[]
): Promise<T> {
  if (选项列表.length === 0) {
    throw new Error('交互选择列表不能为空')
  }

  console.log(`\n${标题}`)
  for (let i = 0; i < 选项列表.length; i += 1) {
    let 选项 = 选项列表[i]
    if (选项 !== undefined) {
      console.log(`  [${i + 1}] ${选项.标签}`)
    }
  }

  while (true) {
    let 输入 = await 交互输入(`请输入选项编号 (1-${选项列表.length}): `)
    let 编号 = Number(输入)
    if (Number.isInteger(编号) && 编号 >= 1 && 编号 <= 选项列表.length) {
      let 选中 = 选项列表[编号 - 1]
      if (选中 !== undefined) {
        return 选中.值
      }
    }
    console.log('输入无效，请重新输入对应的数字编号。')
  }
}
