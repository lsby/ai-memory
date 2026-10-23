/** 等待指定毫秒; 中断信号触发时提前结束(不抛错) */
export async function 可中断等待(毫秒: number, 信号: AbortSignal | undefined): Promise<void> {
  await new Promise<void>((resolve) => {
    let 已完成 = false
    let 完成 = (): void => {
      if (已完成 === true) return
      已完成 = true
      if (信号 !== undefined) 信号.removeEventListener('abort', 中断处理)
      resolve()
    }
    let timer = setTimeout(完成, 毫秒)
    let 中断处理 = (): void => {
      clearTimeout(timer)
      完成()
    }
    if (信号 !== undefined) {
      信号.addEventListener('abort', 中断处理, { once: true })
      if (信号.aborted === true) 中断处理()
    }
  })
}
