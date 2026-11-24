import path from 'node:path'
import {
  交互确认,
  交互输入,
  交互选择,
  包信息,
  包变更状态,
  扫描工作区包,
  是否在Caret兼容范围内,
  执行命令继承输出,
  查找包,
  检查Git工作区干净与远程同步,
  检测包变更状态,
  计算下一版本,
  计算关联发布包,
} from './workspace-utils.js'

type 升级计划项 = {
  包: 包信息
  目标版本: string
}

function 打印用法(): void {
  console.log(`用法: pnpm release [包名] [版本] [-y|--yes]

参数说明:
  [包名]     可选，不传则通过方向键交互选择（如 ai-agent / ai-memory）
  [版本]     可选，不传则通过方向键交互选择（如 patch / minor / major / 0.2.0）
  -y, --yes  跳过交互提示（此时必须显式指定 <包名> 和 <版本>，关联包默认按 patch 升级）`)
}

async function 选择包升级版本(
  包: 包信息,
  默认版本参数?: string
): Promise<string> {
  if (默认版本参数 !== undefined) {
    let 直接版本 = 计算下一版本(包.版本, 默认版本参数)
    if (直接版本 !== null) {
      return 直接版本
    }
  }

  let patch版本 = 计算下一版本(包.版本, 'patch') ?? 包.版本
  let minor版本 = 计算下一版本(包.版本, 'minor') ?? 包.版本
  let major版本 = 计算下一版本(包.版本, 'major') ?? 包.版本

  let 选择结果 = await 交互选择<string>(
    `请选择 ${包.名称} (当前 ${包.版本}) 的升级方式:`,
    [
      { 标签: `patch (${包.版本} -> ${patch版本})`, 值: patch版本 },
      { 标签: `minor (${包.版本} -> ${minor版本})`, 值: minor版本 },
      { 标签: `major (${包.版本} -> ${major版本})`, 值: major版本 },
      { 标签: '自定义版本号', 值: '__custom__' },
    ]
  )

  if (选择结果 !== '__custom__') {
    return 选择结果
  }

  while (true) {
    let 自定义输入 = await 交互输入(`请输入 ${包.名称} 的目标版本号 (如 1.2.3): `)
    let 计算结果 = 计算下一版本(包.版本, 自定义输入)
    if (
      计算结果 !== null &&
      自定义输入 !== 'patch' &&
      自定义输入 !== 'minor' &&
      自定义输入 !== 'major'
    ) {
      return 计算结果
    }
    console.log('版本号格式无效，请输入合法的语义化版本号（如 1.2.3）。')
  }
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

  let 包名参数 = 位置参数[0]
  let 版本参数 = 位置参数[1]

  if (位置参数.length > 2) {
    console.error('错误：参数过多。')
    打印用法()
    process.exitCode = 1
    return
  }

  if (跳过确认 && (包名参数 === undefined || 版本参数 === undefined)) {
    console.error('错误：使用 -y / --yes 跳过交互时，必须显式指定 <包名> 和 <版本>。')
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
  let 变更状态列表 = await Promise.all(
    所有包.map(async (包) => ({
      包,
      状态: await 检测包变更状态(根目录, 包),
    }))
  )
  let 变更状态映射 = new Map<string, 包变更状态>()
  for (let 项 of 变更状态列表) {
    变更状态映射.set(项.包.名称, 项.状态)
  }

  let 目标包: 包信息 | null = null

  if (包名参数 !== undefined) {
    目标包 = 查找包(所有包, 包名参数)
    if (目标包 === null) {
      console.error(`错误：未找到名为 "${包名参数}" 的工作区包。`)
      console.error(`可用包：${所有包.map((item) => item.短名称).join(', ')}`)
      process.exitCode = 1
      return
    }
    let 指定包状态 = 变更状态映射.get(目标包.名称)
    if (指定包状态 !== undefined && !指定包状态.有变更 && !跳过确认) {
      let 仍继续 = await 交互确认(
        `提示：${目标包.名称} 自 ${指定包状态.上次Tag ?? '上次发布'} 以来没有任何文件变更，确定仍要发版吗？`,
        false
      )
      if (!仍继续) {
        console.log('已取消 release 操作。')
        return
      }
    }
  } else {
    let 有变更的包 = 变更状态列表.filter((item) => item.状态.有变更)
    if (有变更的包.length === 0) {
      console.log('所有包自上次发布以来均无代码变更，不需要发新版本。')
      return
    }

    if (有变更的包.length === 1) {
      let 唯一项 = 有变更的包[0]
      if (唯一项 !== undefined) {
        目标包 = 唯一项.包
        let 来源提示 =
          唯一项.状态.上次Tag !== null
            ? `自 ${唯一项.状态.上次Tag} 以来有 ${唯一项.状态.变更文件数} 个文件变更`
            : '首次发布'
        console.log(
          `\n检测到仅 ${目标包.名称} (${目标包.版本}) 需要发版（${来源提示}，其余包无变更已自动跳过）。`
        )
      }
    }

    if (目标包 === null) {
      目标包 = await 交互选择<包信息>(
        '请选择要发布的包:',
        有变更的包.map(({ 包, 状态 }) => {
          let 下游列表 = 计算关联发布包(所有包, 包.名称).filter(
            (item) => item.名称 !== 包.名称
          )
          let 变更提示 =
            状态.上次Tag !== null
              ? `${状态.变更文件数} 个文件变更`
              : '首次发布'
          let 依赖提示 =
            下游列表.length > 0
              ? ` | 被 ${下游列表.map((item) => item.短名称).join(', ')} 依赖`
              : ''
          return {
            标签: `${包.名称} (${包.版本}) [${变更提示}${依赖提示}]`,
            值: 包,
          }
        })
      )
    }
  }

  let 主包目标版本: string
  if (版本参数 !== undefined) {
    let 解析目标 = 计算下一版本(目标包.版本, 版本参数)
    if (解析目标 === null) {
      console.error(
        `错误：无效的版本参数 "${版本参数}"，请使用 patch / minor / major 或合法版本号（如 1.2.3）。`
      )
      process.exitCode = 1
      return
    }
    主包目标版本 = 解析目标
  } else {
    主包目标版本 = await 选择包升级版本(目标包)
  }

  // 所有交互选择必须在最开始全部完成，之后不再弹出任何交互
  let 升级计划: 升级计划项[] = [{ 包: 目标包, 目标版本: 主包目标版本 }]
  let 下游关联包列表 = 计算关联发布包(所有包, 目标包.名称).filter(
    (item) => item.名称 !== 目标包.名称
  )

  if (下游关联包列表.length > 0) {
    let 主包仍兼容 = 是否在Caret兼容范围内(目标包.版本, 主包目标版本)
    for (let 下游包 of 下游关联包列表) {
      let 下游状态 = 变更状态映射.get(下游包.名称)
      let 下游有变更 = 下游状态 !== undefined && 下游状态.有变更
      let 需要升级下游 = false

      if (跳过确认) {
        需要升级下游 = !主包仍兼容 || 下游有变更
      } else if (!主包仍兼容) {
        需要升级下游 = await 交互确认(
          `\n${目标包.名称} 新版本 (${主包目标版本}) 超出了 ^${目标包.版本} 兼容范围，是否同步升级 ${下游包.名称}？`,
          true
        )
      } else if (下游有变更) {
        需要升级下游 = await 交互确认(
          `\n${下游包.名称} 依赖了 ${目标包.名称} 且自身也有文件变更，是否一并升级 ${下游包.名称}？`,
          true
        )
      } else {
        需要升级下游 = await 交互确认(
          `\n${目标包.名称} 本次为兼容升级且 ${下游包.名称} 无代码变更，是否仍要一并升级 ${下游包.名称}？`,
          false
        )
      }

      if (需要升级下游) {
        if (跳过确认) {
          let 默认下游版本 = 计算下一版本(下游包.版本, 'patch')
          if (默认下游版本 === null) {
            throw new Error(`无法为 ${下游包.名称} 计算 patch 版本`)
          }
          升级计划.push({ 包: 下游包, 目标版本: 默认下游版本 })
        } else {
          let 选定下游版本 = await 选择包升级版本(下游包)
          升级计划.push({ 包: 下游包, 目标版本: 选定下游版本 })
        }
      }
    }
  }

  console.log('\n即将执行以下版本升级并推送到 GitHub：')
  for (let 项 of 升级计划) {
    console.log(`  - ${项.包.名称}: ${项.包.版本} -> ${项.目标版本}`)
  }

  if (!跳过确认) {
    let 已确认 = await 交互确认('\n确认无误并开始升级版本、提交并推送到 GitHub 吗？')
    if (!已确认) {
      console.log('已取消 release 操作。')
      return
    }
  }

  // 无人值守执行阶段
  for (let 项 of 升级计划) {
    let 相对清单路径 = path.relative(根目录, 项.包.清单路径)
    let bumpp退出码 = await 执行命令继承输出(
      'pnpm',
      [
        'exec',
        'bumpp',
        '--release',
        项.目标版本,
        相对清单路径,
        '--no-commit',
        '--no-tag',
        '--no-push',
        '--yes',
      ],
      根目录
    )
    if (bumpp退出码 !== 0) {
      throw new Error(`bumpp 升级 ${项.包.名称} 失败，退出码 ${bumpp退出码}`)
    }
  }

  let 清单路径列表 = 升级计划.map((项) => path.relative(根目录, 项.包.清单路径))
  let add退出码 = await 执行命令继承输出('git', ['add', ...清单路径列表], 根目录)
  if (add退出码 !== 0) {
    throw new Error('git add 失败')
  }

  let 提交摘要 = 升级计划
    .map((项) => `${项.包.短名称}@${项.目标版本}`)
    .join(', ')
  let commit退出码 = await 执行命令继承输出(
    'git',
    ['commit', '-m', `chore(release): ${提交摘要}`],
    根目录
  )
  if (commit退出码 !== 0) {
    throw new Error('git commit 失败')
  }

  for (let 项 of 升级计划) {
    let tag名称 = `${项.包.名称}@${项.目标版本}`
    let tag退出码 = await 执行命令继承输出('git', ['tag', tag名称], 根目录)
    if (tag退出码 !== 0) {
      throw new Error(`创建 git tag ${tag名称} 失败`)
    }
  }

  let push退出码 = await 执行命令继承输出(
    'git',
    ['push', '--follow-tags'],
    根目录
  )
  if (push退出码 !== 0) {
    throw new Error('git push --follow-tags 失败')
  }

  console.log('\n版本升级并推送 GitHub 完成！')
  console.log('接下来可以运行 `pnpm publish:npm` 发布到 npm。')
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})

async function main(): Promise<void> {
  await 主流程()
}
