import { ApiError, request } from './api'

const currentMealKey = 'foodmaster.trial.currentMealId'
const discardQueueKey = 'foodmaster.trial.pendingMealDiscards'
let discardInProgress = false

function queuedIds(): string[] {
  const stored = wx.getStorageSync(discardQueueKey) as unknown
  return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string' && !!id) : []
}

export function abandonCurrentMeal(): boolean {
  const mealId = wx.getStorageSync(currentMealKey) as string | undefined
  if (!mealId) return false
  wx.setStorageSync(discardQueueKey, Array.from(new Set([...queuedIds(), mealId])))
  wx.removeStorageSync(currentMealKey)
  return true
}

export async function discardAbandonedMeals(): Promise<void> {
  if (discardInProgress) return
  discardInProgress = true
  try {
    const attempted = new Set<string>()
    while (true) {
      const pending = queuedIds().filter((id) => !attempted.has(id))
      if (!pending.length) break
      for (const mealId of pending) {
        attempted.add(mealId)
        try {
          const meal = await request<{ status: string }>(`/meals/${mealId}`)
          if (meal.status === 'DRAFT') {
            await request(`/meals/${mealId}`, { method: 'DELETE', data: { reason: '照护者退出未保存的识别流程' } })
          }
          wx.setStorageSync(discardQueueKey, queuedIds().filter((id) => id !== mealId))
        } catch (caught) {
          if (caught instanceof ApiError && caught.statusCode === 404) {
            wx.setStorageSync(discardQueueKey, queuedIds().filter((id) => id !== mealId))
          }
          // 网络失败时保留队列，下次进入小程序继续清理；不再复用该草稿。
        }
      }
    }
  } finally {
    discardInProgress = false
  }
}
