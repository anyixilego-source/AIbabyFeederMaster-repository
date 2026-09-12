import { ApiError, request } from '../../utils/api'
import { ensureSessionContext, SessionContext, SubjectSummary } from '../../utils/session'

interface Avoidance { foodId: string; foodName: string; reason: string | null }

function sexLabel(sex: SubjectSummary['sex']): string {
  if (sex === 'FEMALE') return '女宝宝'
  if (sex === 'MALE') return '男宝宝'
  return '未设置'
}

function ageLabel(birthDate: string): string {
  const birth = new Date(`${birthDate}T00:00:00`)
  const today = new Date()
  let months = (today.getFullYear() - birth.getFullYear()) * 12 + today.getMonth() - birth.getMonth()
  if (today.getDate() < birth.getDate()) months -= 1
  return `${Math.max(0, months)}个月`
}

async function context(): Promise<SessionContext> {
  const app = getApp<IAppOption>()
  const value = await (app.globalData.ready || ensureSessionContext())
  app.globalData.householdId = value.householdId || undefined
  app.globalData.subjectId = value.subjectId || undefined
  return value
}

Page({
  data: {
    loading: true, name: '宝宝', sexText: '未设置', birthDate: '', ageText: '',
    basic: [] as Array<{ tone: string; badge: string; label: string; value: string }>,
    health: [] as Array<{ tone: string; badge: string; label: string; value: string; good?: boolean }>,
  },

  onShow() { void this.load() },

  async load() {
    this.setData({ loading: true })
    try {
      const active = await context()
      if (!active.subjectId) throw new Error('请先建立宝宝档案')
      const [subject, avoidances] = await Promise.all([
        request<SubjectSummary>(`/subjects/${active.subjectId}`),
        active.householdId ? request<Avoidance[]>(`/households/${active.householdId}/food-avoidances`) : Promise.resolve([]),
      ])
      const age = ageLabel(subject.birthDate)
      const avoidanceText = avoidances.length ? avoidances.map((item) => item.foodName).join('、') : '暂无'
      this.setData({
        name: subject.displayName, sexText: sexLabel(subject.sex), birthDate: subject.birthDate, ageText: age,
        basic: [
          { tone: 'coral', badge: '性', label: '性别', value: sexLabel(subject.sex) },
          { tone: 'green', badge: '生', label: '出生日期', value: subject.birthDate },
          { tone: 'yellow', badge: '龄', label: '月龄', value: age },
        ],
        health: [
          { tone: 'orange', badge: '避', label: '家庭避免食材（非医学禁忌）', value: avoidanceText, good: avoidances.length === 0 },
          { tone: 'green', badge: '注', label: '其他健康档案', value: '暂未接入' },
        ],
      })
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '档案加载失败'
      wx.showToast({ title: message, icon: 'none' })
    } finally { this.setData({ loading: false }) }
  },

  goBack() { wx.redirectTo({ url: '/pages/index/index' }) },
  toggleEdit() { wx.showToast({ title: '当前先展示已保存档案', icon: 'none' }) },
  editItem() { wx.showToast({ title: '档案编辑将在后续工作包接入', icon: 'none' }) },
  changeAvatar() { wx.showToast({ title: '头像当前仅作本地展示', icon: 'none' }) },
})
