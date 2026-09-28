const IMAGE_RETENTION_KEY = 'foodmaster.image.retention'
// 保留服务端已接受的枚举值；新保存的图片按页面所示天数计算到期时间。
const daysByChoice = { ONE_MONTH: 30, SIX_MONTHS: 180, ONE_YEAR: 365 } as const
export type RetentionChoice = keyof typeof daysByChoice
export const retentionOptions: Array<{ value: RetentionChoice; label: string }> = [
  { value: 'ONE_MONTH', label: '30天' },
  { value: 'SIX_MONTHS', label: '180天' },
  { value: 'ONE_YEAR', label: '365天' },
]

interface RetentionRecord { filePath: string; retention: RetentionChoice; expiresAt: number }

function records(): RetentionRecord[] {
  const value = wx.getStorageSync(IMAGE_RETENTION_KEY) as unknown
  return Array.isArray(value) ? value as RetentionRecord[] : []
}

export function cleanupExpiredLocalImages(now = Date.now()): void {
  const active: RetentionRecord[] = []
  for (const record of records()) {
    if (record?.filePath && record.expiresAt > now) active.push(record)
    else if (record?.filePath) wx.removeSavedFile({ filePath: record.filePath })
  }
  wx.setStorageSync(IMAGE_RETENTION_KEY, active)
}

export function saveLocalImage(tempFilePath: string, retention: RetentionChoice): Promise<string> {
  const remember = (filePath: string) => {
    const expiresAt = Date.now() + daysByChoice[retention] * 24 * 60 * 60 * 1000
    const next = records().filter((record) => record.filePath !== filePath)
    next.push({ filePath, retention, expiresAt })
    wx.setStorageSync(IMAGE_RETENTION_KEY, next)
    return filePath
  }
  if (tempFilePath.includes(wx.env.USER_DATA_PATH)) return Promise.resolve(remember(tempFilePath))
  return new Promise((resolve, reject) => {
    wx.saveFile({
      tempFilePath,
      success(result) {
        resolve(remember(result.savedFilePath))
      },
      fail: reject,
    })
  })
}
