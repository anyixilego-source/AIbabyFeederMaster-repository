import { request, ApiError } from './api'

export interface FeedbackModule { code: string; name: string; children?: FeedbackModule[] }
export function copyModules(nodes: FeedbackModule[]): FeedbackModule[] {
  return nodes.map(n => ({ code: n.code, name: n.name, ...(n.children?.length ? { children: copyModules(n.children) } : {}) }))
}
export interface FeedbackSummary { feedbackId: string; description: string; submittedAt: string; modulePath: Array<{ name: string }>; imageCount: number }
export interface FeedbackDetail extends FeedbackSummary { accountId: string; contact: string | null; context: { appVersion: string; environment: string; pagePath: string }; images: Array<{ attachmentId: string }> }
export function locationLabel(path: FeedbackSummary['modulePath']) { return path?.map(n => n.name).join(' › ') || '未选择功能位置' }
export function submittedLabel(value: string) {
  const date = new Date(value), pad = (n: number) => String(n).padStart(2, '0')
  return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}` : ''
}
export async function downloadFeedbackImage(id: string): Promise<string> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('图片编号无效')
  const data = await request<ArrayBuffer>('/feedback/images/' + encodeURIComponent(id), { responseType: 'arraybuffer' })
  if (!(data instanceof ArrayBuffer) || !data.byteLength || data.byteLength > 5 * 1024 * 1024) throw new Error('图片内容无效')
  const b = new Uint8Array(data), extension = b[0] === 137 && b[1] === 80 ? 'png' : b[0] === 255 && b[1] === 216 ? 'jpg' : b[0] === 82 && b[1] === 73 && b[8] === 87 && b[9] === 69 ? 'webp' : ''
  if (!extension) throw new Error('图片格式无效')
  const path = wx.env.USER_DATA_PATH + '/feedback-preview-' + id + '-' + Date.now() + '.' + extension
  await new Promise<void>((resolve, reject) => wx.getFileSystemManager().writeFile({ filePath: path, data, success: () => resolve(), fail: reject }))
  return path
}
export function removeFeedbackImage(path: string) {
  if (!path.startsWith(wx.env.USER_DATA_PATH + '/feedback-preview-')) return
  wx.getFileSystemManager().unlink({ filePath: path, fail: () => {} })
}
export function feedbackError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.statusCode === 401) return '登录已过期，请返回“我的”重新登录后再试。'
    if (error.statusCode === 403) return '当前账号没有反馈管理权限。'
    if (error.statusCode === 404) return '反馈已删除、到期或暂不可查看。'
  }
  return '暂时无法读取，请稍后重试。'
}
