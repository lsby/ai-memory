import {
  交互确认,
  包信息,
  扫描工作区包,
  是否在Caret兼容范围内,
  执行命令,
  执行命令继承输出,
  拓扑排序,
  查找包,
  检查Git工作区干净与远程同步,
  比较语义化版本,
  计算关联发布包,
} from './workspace-utils.js'

type 待发布项 = {
  包: 包信息
  线上版本: string | null
}

function 打印用法(): void {
  console.log(`用法: pnpm publish:npm [包名] [-y|--yes]

参数说明:
  [包名]     可选，指定要发布检查的起始包名（自动包含关联下游包）；不传则自动检测所有包
  -y, --yes  跳过最开始的确认提示，直接执行检查并发布`)
}

async function 获取Npm线上版本(包名: string, 根目录: string): Promise<string | null> {
  let 结果 = await 执行命令('npm', ['view', 包名, 'version'], 根目录)
  if (结果.退出码 !== 0) {
    if (结果.标准错误.includes('E404') || 结果.标准错误.includes('404')) {
      return null
    }
    throw new Error(`查询 ${包名} 的 npm 线上版本失败：${结果.标准错误}`)
  }
  return 结果.标准输出.length > 0 ? 结果.标准输出 : null
}

async function 主流程(): Promise<void> {
  let 根目录 = process.cwd()
  let 原始参数 = process.argv.slice(2)

  let 跳过确认 = false
  let 位置参数: string[] = []

  for (let 参数 of 原始参数) {
    if (参数 === '-y' || 参数 === '--yes') {
      跳过确认 = true
    } else if (参数 === '-h' || 参数 === '--help') {
      打印用法()
      return
    } else {
      位置参数.push(参数)
    }
  }

  if (位置参数.length > 1) {
    console.error('错误：最多只能指定一个包名参数。')
    打印用法()
    process.exitCode = 1
    return
  }

  console.log('正在检查 Git 工作区状态与远程同步情况...')
  let git检查 = await 检查Git工作区干净与远程同步(根目录)
  if (!git检查.成功) {
    console.error(`错误：${git检查.错误信息}`)
    process.exitCode = 1
    return
  }

  let 所有包 = await 扫描工作区包(根目录)
  let 检查范围包: 包信息[] = 所有包

  let 指定包名 = 位置参数[0]
  if (指定包名 !== undefined) {
    let 目标包 = 查找包(所有包, 指定包名)
    if (目标包 === null) {
      console.error(`错误：未找到名为 "${指定包名}" 的工作区包。`)
      console.error(`可用包：${所有包.map((item) => item.短名称).join(', ')}`)
      process.exitCode = 1
      return
    }
    检查范围包 = 计算关联发布包(所有包, 目标包.名称)
  }

  console.log('正在查询 npm 线上版本并分析待发布包...')
  let 线上版本结果 = await Promise.all(
    所有包.map(async (包) => ({
      包,
      线上版本: await 获取Npm线上版本(包.名称, 根目录),
    }))
  )

  let 线上版本映射 = new Map<string, string | null>()
  for (let 项 of 线上版本结果) {
    线上版本映射.set(项.包.名称, 项.线上版本)
  }

  let 待发布包列表: 包信息[] = []

  for (let 包 of 检查范围包) {
    let 线上版本 = 线上版本映射.get(包.名称) ?? null
    if (线上版本 === null || 比较语义化版本(包.版本, 线上版本) > 0) {
      待发布包列表.push(包)
    }
  }

  if (待发布包列表.length === 0) {
    console.log('没有需要发布的包（本地版本均未高于 npm 线上版本）。')
    return
  }

  // 仅当发布的新版本超出下游包原有 ^ 兼容范围且下游包未同步升级时，才阻止发布
  let 待发布名集合 = new Set<string>(待发布包列表.map((item) => item.名称))
  for (let 包 of 待发布包列表) {
    let 线上版本 = 线上版本映射.get(包.名称) ?? null
    if (线上版本 === null || 是否在Caret兼容范围内(线上版本, 包.版本)) {
      continue
    }
    let 关联全部 = 计算关联发布包(所有包, 包.名称)
    for (let 关联包 of 关联全部) {
      if (关联包.名称 !== 包.名称 && !待发布名集合.has(关联包.名称)) {
        console.error(
          `错误：${包.名称} 的新版本 (${包.版本}) 已超出 ^${线上版本} 兼容范围，但依赖它的 ${关联包.名称} 没有同步升级发布。请先运行 pnpm release 升级 ${关联包.名称}。`
        )
        process.exitCode = 1
        return
      }
    }
  }

  let 排序后待发布 = 拓扑排序(待发布包列表)
  let 待发布计划: 待发布项[] = 排序后待发布.map((包) => ({
    包,
    线上版本: 线上版本映射.get(包.名称) ?? null,
  }))

  // 所有交互选择必须在最开始全部完成，之后无人值守执行
  console.log('\n即将按以下顺序验证并发布到 npm：')
  for (let 项 of 待发布计划) {
    let 线上显示 = 项.线上版本 ?? '未发布'
    console.log(`  - ${项.包.名称}: ${线上显示} -> ${项.包.版本}`)
  }
  console.log('验证步骤：pnpm run check:all && pnpm run test')

  if (!跳过确认) {
    let 已确认 = await 交互确认('\n确认开始执行检查、单测并发布到 npm 吗？')
    if (!已确认) {
      console.log('已取消 publish 操作。')
      return
    }
  }

  // 无人值守执行阶段
  console.log('\n正在执行构建与代码检查 (pnpm run check:all)...')
  let 检查退出码 = await 执行命令继承输出('pnpm', ['run', 'check:all'], 根目录)
  if (检查退出码 !== 0) {
    throw new Error('代码检查或构建失败，已中止发布')
  }

  console.log('\n正在执行单元测试 (pnpm run test)...')
  let 单测退出码 = await 执行命令继承输出('pnpm', ['run', 'test'], 根目录)
  if (单测退出码 !== 0) {
    throw new Error('单元测试失败，已中止发布')
  }

  for (let 项 of 待发布计划) {
    console.log(`\n正在发布 ${项.包.名称}@${项.包.版本} 到 npm...`)
    let 发布退出码 = await 执行命令继承输出(
      'pnpm',
      ['--filter', 项.包.名称, 'publish', '--access', 'public', '--no-git-checks'],
      根目录
    )
    if (发布退出码 !== 0) {
      throw new Error(`发布 ${项.包.名称} 失败，退出码 ${发布退出码}`)
    }
  }

  console.log('\n全部发布成功！')
}

主流程().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
