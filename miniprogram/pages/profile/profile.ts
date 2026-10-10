import {openPage,navigateRoot,ensureHomeParent} from '../../utils/navigation'
import { ApiError, request } from '../../utils/api'
import { ageDisplay } from '../../utils/age'
import { ensureSessionContext, refreshSessionContext, SessionContext, SubjectSummary } from '../../utils/session'

interface Avoidance { foodId: string; foodName: string; reason: string | null }

function sexLabel(sex: SubjectSummary['sex']): string {
  if (sex === 'FEMALE') return '女宝宝'
  if (sex === 'MALE') return '男宝宝'
  return '未设置'
}

async function context(): Promise<SessionContext> {
  const app = getApp<IAppOption>()
  const value = await (app.globalData.ready || ensureSessionContext())
  return value
}

function todayDate(): string {
  const today = new Date()
  return `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`
}

Page({
  data: { reviewLabel:wx.getSystemInfoSync().platform==='devtools'?(wx.getStorageSync('foodmaster.reviewEnvironment')?.label || ''):'',
    loading: true, saving: false, editing: false, name: '宝宝', sexText: '未设置', birthDate: '', ageText: '',
    canReadFeedback: false, errorMessage: '', subjectId: '', draftName: '', draftBirthDate: '', draftSexIndex: 2, todayDate: todayDate(),
    sexOptions: [{ label: '女宝宝', value: 'FEMALE' }, { label: '男宝宝', value: 'MALE' }, { label: '暂不设置', value: 'UNSPECIFIED' }],
    basic: [] as Array<{ tone: string; badge: string; label: string; value: string; editable?: boolean }>,
    health: [] as Array<{ tone: string; badge: string; label: string; value: string; good?: boolean; editable?: boolean }>,
  },

  _loadSequence: 0,
  onShow() { if(ensureHomeParent(this))return;void this.load() },
  onHide() { ++this._loadSequence },

  clearProfile() {
    this.setData({ subjectId: '', name: '宝宝', sexText: '未设置', birthDate: '', ageText: '', basic: [], health: [], editing: false, draftName: '', draftBirthDate: '', draftSexIndex: 2 })
  },
  async load() {
    const sequence = ++this._loadSequence
    const app = getApp<IAppOption>()
    const ready = app.globalData.ready
    const isCurrent = () => sequence === this._loadSequence && app.globalData.ready === ready
    this.clearProfile()
    this.setData({ canReadFeedback: false, loading: true, errorMessage: '' })
    try {
      const active = await (ready || ensureSessionContext())
      if (!isCurrent()) return
      void this.loadFeedbackAccess(sequence, ready)
      if (!active.subjectId) return
      const [subject, avoidances] = await Promise.all([
        request<SubjectSummary>(`/subjects/${active.subjectId}`),
        active.householdId ? request<Avoidance[]>(`/households/${active.householdId}/food-avoidances`) : Promise.resolve([]),
      ])
      if (!isCurrent()) return
      const age = ageDisplay(subject.birthDate)
      const avoidanceText = avoidances.length ? avoidances.map(item => item.foodName).join('、') : '暂无'
      this.setData({
        subjectId: active.subjectId, name: subject.displayName, sexText: sexLabel(subject.sex), birthDate: subject.birthDate, ageText: age,
        basic: [
          { tone: 'coral', badge: '性', label: '性别', value: sexLabel(subject.sex), editable: true },
          { tone: 'green', badge: '生', label: '出生日期', value: subject.birthDate, editable: true },
          { tone: 'yellow', badge: '龄', label: '月龄', value: age },
        ],
        health: [
          { tone: 'orange', badge: '避', label: '家庭避免食材（非医学禁忌）', value: avoidanceText, good: avoidances.length === 0, editable: true },
          { tone: 'yellow', badge: '配', label: '饮食推荐条件', value: '查看或修改', editable:true },
          { tone: 'green', badge: '注', label: '其他健康档案', value: '暂未接入' },
        ],
      })
    } catch (caught) {
      if (!isCurrent()) return
      this.clearProfile()
      const message = caught instanceof ApiError && caught.statusCode === 401 ? '登录已过期，请重新登录后再试。'
        : caught instanceof ApiError && [403, 404].includes(caught.statusCode) ? '无法访问当前宝宝档案，请检查选择的宝宝或家庭权限。'
        : '档案暂时无法加载，请稍后重试。'
      this.setData({ errorMessage: message })
      wx.showToast({ title: message, icon: 'none' })
    } finally { if (sequence === this._loadSequence) this.setData({ loading: false }) }
  },

  async loadFeedbackAccess(sequence: number, ready: IAppOption['globalData']['ready']) {
    try {
      const access = await request<{ canReadFeedback: boolean }>('/feedback/maintenance/access')
      if (sequence === this._loadSequence && getApp<IAppOption>().globalData.ready === ready) this.setData({ canReadFeedback: access.canReadFeedback === true })
    } catch { if (sequence === this._loadSequence) this.setData({ canReadFeedback: false }) }
  },
  openFeedbackManagement() { if (this.data.canReadFeedback) openPage('/pages/feedback-management/feedback-management') },
  goBack() { navigateRoot('/pages/index/index') },
  openMenu() { openPage('/pages/menu/menu') },
  openCollections(){openPage('/pages/diet-favorites/diet-favorites')},
  openFeedback() { openPage('/pages/feedback/feedback') },
  openAbout() { openPage('/pages/about/about') },
  toggleEdit() {
    if (this.data.loading || this.data.errorMessage) return
    const draftSexIndex = this.data.sexText === '女宝宝' ? 0 : this.data.sexText === '男宝宝' ? 1 : 2
    this.setData({ editing: true, draftName: this.data.name, draftBirthDate: this.data.birthDate, draftSexIndex })
  },
  editItem(event: WechatMiniprogram.BaseEvent) {
    const label = event.currentTarget.dataset.label as string | undefined
    if (!event.currentTarget.dataset.editable) return
    if (label === '性别' || label === '出生日期') this.toggleEdit()
    else if (label === '家庭避免食材（非医学禁忌）') this.openMenu()
    else if (label === '饮食推荐条件') openPage('/pages/diet-menu/diet-menu?settingsOnly=1&subjectId='+encodeURIComponent(this.data.subjectId))
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
