import 询问器 from 'inquirer'
import 文件系统 from 'node:fs'
import 路径 from 'node:path'

type 重命名配置 = {
  旧项目名_短横线: string
  新项目名_短横线: string
  旧项目名_点分: string
  新项目名_点分: string
  旧项目名_斜杠: string
  新项目名_斜杠: string
  旧项目名_冒号: string
  新项目名_冒号: string
}

/**
 * 获取项目根目录
 */
function 获取项目根目录(): string {
  return 路径.resolve(import.meta.dirname, '../..')
}

/**
 * 递归读取目录中的所有文件
 */
function 递归读取文件(目录路径: string, 排除目录: string[] = []): string[] {
  let 文件列表: string[] = []
  let 目录内容 = 文件系统.readdirSync(目录路径)

  for (let 项 of 目录内容) {
    let 完整路径 = 路径.join(目录路径, 项)
    let 状态 = 文件系统.statSync(完整路径)
    if (状态.isDirectory() === true) {
      if (排除目录.includes(项)) {
        continue
      }
      文件列表 = 文件列表.concat(递归读取文件(完整路径, 排除目录))
    } else {
      文件列表.push(完整路径)
    }
  }

  return 文件列表
}

/**
 * 替换文件内容
 */
function 替换文件内容(文件路径: string, 配置: 重命名配置): boolean {
  let 内容 = 文件系统.readFileSync(文件路径, 'utf-8')
  let 原内容 = 内容

  // 按顺序替换，从最具体的到最一般的
  内容 = 内容.replaceAll(配置.旧项目名_斜杠, 配置.新项目名_斜杠)
  内容 = 内容.replaceAll(配置.旧项目名_冒号, 配置.新项目名_冒号)
  内容 = 内容.replaceAll(配置.旧项目名_点分, 配置.新项目名_点分)
  内容 = 内容.replaceAll(配置.旧项目名_短横线, 配置.新项目名_短横线)

  if (内容 !== 原内容) {
    文件系统.writeFileSync(文件路径, 内容, 'utf-8')
    return true
  }

  return false
}

/**
 * 主函数
 */
async function 主函数(): Promise<void> {
  console.log('🚀 项目重命名工具')
  console.log('====================\n')

  let 回答_步骤1: { 作者名: string; 项目名: string } = await 询问器.prompt([
    { type: 'input', name: '作者名', message: '请输入新的作者名 (例如: mycompany):', default: 'lsby' },
    {
      type: 'input',
      name: '项目名',
      message: '请输入新的项目名 (例如: my-awesome-project):',
      default: 'playground-ts-lib',
    },
  ])

  if (回答_步骤1.作者名.trim().length === 0) {
    console.log('❌ 作者名不能为空')
    return
  }
  if (!/^[a-z0-9-]+$/u.test(回答_步骤1.作者名) === true) {
    console.log('❌ 作者名只能包含小写字母、数字和短横线')
    return
  }
  if (回答_步骤1.项目名.trim().length === 0) {
    console.log('❌ 项目名不能为空')
    return
  }
  if (!/^[a-z0-9-]+$/u.test(回答_步骤1.项目名) === true) {
    console.log('❌ 项目名只能包含小写字母、数字和短横线')
    return
  }

  let 回答_步骤2: { 确认: boolean } = await 询问器.prompt([
    {
      type: 'confirm',
      name: '确认',
      message: `确认将项目从 "@lsby/playground-ts-lib" 重命名为 "@${回答_步骤1.作者名}/${回答_步骤1.项目名}"?`,
      default: false,
    },
  ])

  if (回答_步骤2.确认 === false) {
    console.log('❌ 已取消重命名操作')
    return
  }

  let 作者名 = 回答_步骤1.作者名
  let 项目名 = 回答_步骤1.项目名
  let 配置: 重命名配置 = {
    旧项目名_斜杠: '@lsby/playground-ts-lib',
    新项目名_斜杠: `@${作者名}/${项目名}`,
    旧项目名_冒号: '@lsby:playground-ts-lib',
    新项目名_冒号: `@${作者名}:${项目名}`,
    旧项目名_点分: 'lsby.playground.ts.lib',
    新项目名_点分: `${作者名}.${项目名.replaceAll('-', '.')}`,
    旧项目名_短横线: 'lsby-playground-ts-lib',
    新项目名_短横线: `${作者名}-${项目名}`,
  }

  console.log('\n📝 重命名配置:')
  console.log(`  ${配置.旧项目名_斜杠} → ${配置.新项目名_斜杠}`)
  console.log(`  ${配置.旧项目名_冒号} → ${配置.新项目名_冒号}`)
  console.log(`  ${配置.旧项目名_点分} → ${配置.新项目名_点分}`)
  console.log(`  ${配置.旧项目名_短横线} → ${配置.新项目名_短横线}\n`)

  let 排除目录 = ['node_modules', 'dist', 'coverage', 'package', 'release', 'db', 'android', '.parcel-cache']
  let 项目根目录 = 获取项目根目录()
  let 所有文件 = 递归读取文件(项目根目录, 排除目录)
  let 文本文件扩展名 = [
    '.ts',
    '.js',
    '.json',
    '.md',
    '.html',
    '.css',
    '.txt',
    '.yml',
    '.yaml',
    '.env',
    '.gitignore',
    '.dockerignore',
    '.prettierignore',
    '.prettierrc',
    '.cs',
  ]
  let 当前脚本路径 = 路径.relative(项目根目录, import.meta.filename)
  let 需要处理的文件 = 所有文件.filter((文件) => {
    let 扩展名 = 路径.extname(文件)
    let 相对路径 = 路径.relative(项目根目录, 文件)
    let 是文本文件 =
      文本文件扩展名.includes(扩展名) === true ||
      文本文件扩展名.includes(路径.basename(文件)) === true ||
      路径.basename(文件).startsWith('.env') === true
    return 是文本文件 === true && 相对路径 !== 当前脚本路径
  })

  console.log(`📂 找到 ${需要处理的文件.length} 个文件需要处理\n`)

  let 修改的文件数 = 0
  for (let 文件路径 of 需要处理的文件) {
    let 相对路径 = 路径.relative(项目根目录, 文件路径)
    try {
      if (替换文件内容(文件路径, 配置) === true) {
        console.log(`✅ ${相对路径}`)
        修改的文件数 = 修改的文件数 + 1
      }
    } catch (错误) {
      console.error(`❌ ${相对路径}: ${错误}`)
    }
  }

  console.log(`\n🎉 完成！共修改了 ${修改的文件数} 个文件`)
}

主函数().catch((错误) => {
  console.error('❌ 发生错误:', 错误)
  process.exit(1)
})
