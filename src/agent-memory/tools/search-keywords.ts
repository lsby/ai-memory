let 最大基础分词数量 = 64
let 最大检索关键词数量 = 256
let 汉字表达式 = /\p{Script=Han}/u

function 是否包含汉字(内容: string): boolean {
  return 汉字表达式.test(内容)
}

function 拼接自然短语(片段: string[]): string {
  let 结果 = ''
  for (let i = 0; i < 片段.length; i++) {
    let 当前词 = 片段[i]
    if (当前词 === undefined) continue

    let 前一个词 = 片段[i - 1]
    if (前一个词 !== undefined && (是否包含汉字(前一个词) === false || 是否包含汉字(当前词) === false)) {
      结果 += ' '
    }
    结果 += 当前词
  }
  return 结果
}

export function 构建检索关键词(查询内容: string, 目标关键词: string[] = []): string[] {
  let segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
  let 基础分词 = [...segmenter.segment(查询内容)]
    .filter((片段): boolean => 片段.isWordLike === true)
    .map((片段): string => 片段.segment.trim())
    .filter((词语): boolean => 词语.length > 0)
    .slice(0, 最大基础分词数量)

  let 候选词语 = 目标关键词.map((词语): string => 词语.trim()).filter((词语): boolean => 词语.length > 0)
  候选词语.push(...基础分词)

  for (let 长度 = 2; 长度 <= 4; 长度++) {
    for (let 起点 = 0; 起点 <= 基础分词.length - 长度; 起点++) {
      let 片段 = 基础分词.slice(起点, 起点 + 长度)
      候选词语.push(片段.join(' '))

      if (片段.some((词语): boolean => 是否包含汉字(词语))) {
        候选词语.push(拼接自然短语(片段), 片段.join(''))
      }
    }
  }

  return Array.from(new Set(候选词语)).slice(0, 最大检索关键词数量)
}
