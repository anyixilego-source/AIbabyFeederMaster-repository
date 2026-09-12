import { ApiError, request } from '../../utils/api'
import { completeOperation, getPendingOperation, operationPayload } from '../../utils/operation'
import { ensureSessionContext, SessionContext } from '../../utils/session'

interface MealSummary {
  mealId: string
  mealType: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK' | 'OTHER'
  occurredAt: string
  status: 'DRAFT' | 'CONFIRMED'
  notes: string | null
}
interface MealDetail extends MealSummary {
  items: Array<{ observedName: string | null; consumedAmount: string | null; status: string }>
}

const mealLabels: Record<MealSummary['mealType'], string> = {
  BREAKFAST: '早餐', LUNCH: '午餐', DINNER: '晚餐', SNACK: '加餐', OTHER: '其他',
}

function dateOnly(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}
function datesAround(selectedDate: string) {
  const selected = new Date(`${selectedDate}T00:00:00`)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(selected)
    date.setDate(selected.getDate() + index - 6)
    return { week: '日一二三四五六'[date.getDay()], day: date.getDate(), date: dateOnly(date), active: index === 6 }
  })
}
async function context(): Promise<SessionContext> {
  const app = getApp<IAppOption>()
  return app.globalData.ready || ensureSessionContext()
}

Page({
  data: {
    saved: false, loading: false, selectedDate: dateOnly(new Date()), selectedDateLabel: '',
    dates: datesAround(dateOnly(new Date())),
    meals: [] as Array<{ mealId: string; type: string; time: string; name: string; ingredients: string; tags: string[]; tone: string; position: string }>,
    confirmedCount: 0, consumedTotal: '0',
  },

  onLoad(query: Record<string, string>) {
    if (query.saved === '1' || wx.getStorageSync('mealSaved')) this.setData({ saved: true })
  },
  onShow() { void this.loadMeals() },

  async loadMeals() {
    this.setData({ loading: true })
    try {
      const active = await context()
      if (!active.subjectId) throw new Error('请先建立宝宝档案')
      const summaries = await request<MealSummary[]>(`/subjects/${active.subjectId}/meals`)
      const selected = summaries.filter((meal) => dateOnly(new Date(meal.occurredAt)) === this.data.selectedDate)
      const details = await Promise.all(selected.map((meal) => request<MealDetail>(`/meals/${meal.mealId}`)))
      let consumedTotal = 0
      const meals = details.map((meal) => {
        const confirmed = meal.items.filter((item) => item.status === 'CONFIRMED')
        consumedTotal += confirmed.reduce((sum, item) => sum + Number(item.consumedAmount || 0), 0)
        const occurredAt = new Date(meal.occurredAt)
        return {
          mealId: meal.mealId, type: mealLabels[meal.mealType],
          time: `${occurredAt.getHours().toString().padStart(2, '0')}:${occurredAt.getMinutes().toString().padStart(2, '0')}`,
          name: meal.notes || `${mealLabels[meal.mealType]}记录`,
          ingredients: confirmed.map((item) => item.observedName || '已确认食品').join('、') || '暂无已确认食物',
          tags: [meal.status === 'CONFIRMED' ? '已确认' : '草稿'],
          tone: meal.mealType === 'DINNER' ? 'night' : meal.mealType === 'SNACK' ? 'snack' : 'day',
          position: '50% center',
        }
      })
      const selectedDate = new Date(`${this.data.selectedDate}T00:00:00`)
      this.setData({
        selectedDateLabel: `${selectedDate.getFullYear()}年${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`, meals,
        confirmedCount: details.filter((meal) => meal.status === 'CONFIRMED').length,
        consumedTotal: consumedTotal.toFixed(consumedTotal % 1 ? 1 : 0),
      })
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '记录加载失败'
      wx.showToast({ title: message, icon: 'none' })
    } finally { this.setData({ loading: false }) }
  },

  goBack() { wx.redirectTo({ url: '/pages/index/index' }) },
  openReport() { wx.redirectTo({ url: '/pages/report/report' }) },
  async addMeal() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const active = await context()
      if (!active.subjectId) throw new Error('请先建立宝宝档案')
      const scope = `create-meal:${active.subjectId}`
      const payload = getPendingOperation(scope) || operationPayload(scope, { mealType: 'OTHER', occurredAt: new Date().toISOString(), notes: '拍照记录' })
      const meal = await request<{ mealId: string }>(`/subjects/${active.subjectId}/meals`, { method: 'POST', data: payload })
      completeOperation(scope, payload.operationId)
      wx.setStorageSync('foodmaster.currentMealId', meal.mealId)
      wx.navigateTo({ url: '/pages/camera/camera' })
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '创建餐食失败'
      wx.showToast({ title: message, icon: 'none' })
    } finally { this.setData({ loading: false }) }
  },
  chooseDate(event: WechatMiniprogram.TouchEvent) {
    const selectedDate = String(event.currentTarget.dataset.date)
    this.setData({ selectedDate, dates: this.data.dates.map((item) => ({ ...item, active: item.date === selectedDate })) })
    void this.loadMeals()
  },
  closeSaved() { this.setData({ saved: false }); wx.removeStorageSync('mealSaved') },
})
