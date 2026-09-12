const IMAGE_RETENTION_KEY = 'foodmaster.image.retention'
const monthsByChoice = { ONE_MONTH: 1, SIX_MONTHS: 6, ONE_YEAR: 12 } as const
export type RetentionChoice = keyof typeof monthsByChoice
export const retentionOptions: Array<{ value: RetentionChoice; label: string }> = [
  { value: 'ONE_MONTH', label: '保存 1 个月' },
  { value: 'SIX_MONTHS', label: '保存半年' },
  { value: 'ONE_YEAR', label: '保存 1 年' },
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
    const expiry = new Date()
    expiry.setMonth(expiry.getMonth() + monthsByChoice[retention])
    const next = records().filter((record) => record.filePath !== filePath)
    next.push({ filePath, retention, expiresAt: expiry.getTime() })
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
