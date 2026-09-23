import { ApiError, request } from '../../utils/api'
import { ensureSessionContext, refreshSessionContext, SessionContext, SubjectSummary } from '../../utils/session'

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

function todayDate(): string {
  const today = new Date()
  return `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`
}

Page({
  data: {
    loading: true, saving: false, editing: false, name: '宝宝', sexText: '未设置', birthDate: '', ageText: '',
    draftName: '', draftBirthDate: '', draftSexIndex: 2, todayDate: todayDate(),
    sexOptions: [{ label: '女宝宝', value: 'FEMALE' }, { label: '男宝宝', value: 'MALE' }, { label: '暂不设置', value: 'UNSPECIFIED' }],
    basic: [] as Array<{ tone: string; badge: string; label: string; value: string; editable?: boolean }>,
    health: [] as Array<{ tone: string; badge: string; label: string; value: string; good?: boolean; editable?: boolean }>,
  },

  onShow() { void this.load() },

  async load() {
    this.setData({ loading: true })
    try {
      const active = await context()
      if (!active.subjectId) {
        this.setData({ name: '宝宝', sexText: '未设置', birthDate: '', ageText: '', basic: [], health: [] })
        return
      }
      const [subject, avoidances] = await Promise.all([
        request<SubjectSummary>(`/subjects/${active.subjectId}`),
        active.householdId ? request<Avoidance[]>(`/households/${active.householdId}/food-avoidances`) : Promise.resolve([]),
      ])
      const age = ageLabel(subject.birthDate)
      const avoidanceText = avoidances.length ? avoidances.map((item) => item.foodName).join('、') : '暂无'
      this.setData({
        name: subject.displayName, sexText: sexLabel(subject.sex), birthDate: subject.birthDate, ageText: age,
        basic: [
          { tone: 'coral', badge: '性', label: '性别', value: sexLabel(subject.sex), editable: true },
          { tone: 'green', badge: '生', label: '出生日期', value: subject.birthDate, editable: true },
          { tone: 'yellow', badge: '龄', label: '月龄', value: age },
        ],
        health: [
          { tone: 'orange', badge: '避', label: '家庭避免食材（非医学禁忌）', value: avoidanceText, good: avoidances.length === 0, editable: true },
          { tone: 'green', badge: '注', label: '其他健康档案', value: '暂未接入' },
        ],
      })
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '档案加载失败'
      wx.showToast({ title: message, icon: 'none' })
    } finally { this.setData({ loading: false }) }
  },

  goBack() { wx.redirectTo({ url: '/pages/index/index' }) },
  openMenu() { wx.navigateTo({ url: '/pages/menu/menu' }) },
  openAbout() { wx.navigateTo({ url: '/pages/about/about' }) },
  toggleEdit() {
    const draftSexIndex = this.data.sexText === '女宝宝' ? 0 : this.data.sexText === '男宝宝' ? 1 : 2
    this.setData({ editing: true, draftName: this.data.name, draftBirthDate: this.data.birthDate, draftSexIndex })
  },
  editItem(event: WechatMiniprogram.BaseEvent) {
    const label = event.currentTarget.dataset.label as string | undefined
    if (!event.currentTarget.dataset.editable) return
    if (label === '性别' || label === '出生日期') this.toggleEdit()
    else if (label === '家庭避免食材（非医学禁忌）') this.openMenu()
  },
  closeEdit() { if (!this.data.saving) this.setData({ editing: false }) },
  stopPropagation() {},
  onNameInput(event: WechatMiniprogram.Input) { this.setData({ draftName: event.detail.value }) },
  onBirthDateChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ draftBirthDate: event.detail.value }) },
  onSexChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ draftSexIndex: Number(event.detail.value) }) },
  async saveProfile() {
    if (this.data.saving) return
    const displayName = this.data.draftName.trim()
    if (!displayName) { wx.showToast({ title: '请填写宝宝昵称', icon: 'none' }); return }
    if (!this.data.draftBirthDate) { wx.showToast({ title: '请选择出生日期', icon: 'none' }); return }
    this.setData({ saving: true })
    try {
      const active = await context()
      const selected = this.data.sexOptions[this.data.draftSexIndex]
      if (active.subjectId) {
        await request(`/subjects/${active.subjectId}/profile`, {
          method: 'PATCH',
          data: { displayName, birthDate: this.data.draftBirthDate, sex: selected.value, reason: '照护者在小程序更新档案' },
        })
      } else {
        if (!active.householdId) throw new Error('当前账号尚未建立家庭')
        await request(`/households/${active.householdId}/subjects`, {
          method: 'POST',
          data: { displayName, birthDate: this.data.draftBirthDate, sex: selected.value, relationshipType: 'PARENT' },
        })
        await refreshSessionContext()
      }
      this.setData({ editing: false })
      wx.showToast({ title: '档案已保存', icon: 'success' })
      await this.load()
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '档案保存失败'
      wx.showToast({ title: message, icon: 'none' })
    } finally { this.setData({ saving: false }) }
  },
})
