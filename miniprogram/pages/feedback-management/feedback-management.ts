import { request, getAuth, ApiError, reviewEnvironment } from '../../utils/api'
import { openPage, backPage } from '../../utils/navigation'
import { type FeedbackModule, type FeedbackSummary, type FeedbackDetail, copyModules, locationLabel, submittedLabel, downloadFeedbackImage, removeFeedbackImage, feedbackError } from '../../utils/feedback-management'

interface Picture { id: string; path: string; loading: boolean; failed: boolean }
interface ListItem extends FeedbackSummary { location: string; time: string }
Page({
  data: { reviewLabel: reviewEnvironment()?.label || '', mode: 'LIST', feedbackId: '', checking: true, authorized: false, errorMessage: '', loading: false, loadingMore: false, refreshing: false,
    range: '7', ranges: [{ key: '7', label: '最近7天' }, { key: '30', label: '最近30天' }, { key: 'all', label: '全部有效反馈' }],
    moduleCode: '', moduleLabel: '', modules: [] as FeedbackModule[], moduleOptions: [] as FeedbackModule[], moduleTrail: [] as FeedbackModule[], moduleError: '', showModulePicker: false,
    items: [] as ListItem[], nextCursor: '', detail: null as FeedbackDetail | null, detailLocation: '', detailTime: '', pictures: [] as Picture[], showEnvironment: false, environmentLabel: '',
  },
  _alive: false, _epoch: 0, _listSequence: 0, _loaded: false, _session: '', _files: new Set<string>(),
  onLoad(options: { id?: string }) { this.setData({ mode: options.id ? 'DETAIL' : 'LIST', feedbackId: options.id || '' }) },
  onShow() { this._alive = true; void this.authorize() },
  onHide() { this._alive = false; ++this._epoch; ++this._listSequence; this.setData({ loading: false, loadingMore: false, refreshing: false }) },
  onUnload() { this._alive = false; ++this._epoch; this.clearImages() },
  current(epoch: number) {
    if (!this._alive || epoch !== this._epoch) return false
    if (this._session !== (getAuth()?.accessToken || '')) { void this.authorize(); return false }
    return true
  },
  clearImages() { for (const path of this._files) removeFeedbackImage(path); this._files.clear() },
  deny(message: string) {
    this.clearImages(); this._loaded = false
    this.setData({ authorized: false, checking: false, loading: false, loadingMore: false, items: [], detail: null, pictures: [], errorMessage: message })
  },
  async authorize() {
    const epoch = ++this._epoch, token = getAuth()?.accessToken || ''
    if (token !== this._session) { this.clearImages(); this._loaded = false; this.setData({ items: [], detail: null, pictures: [] }) }
    this._session = token
    this.setData({ checking: true, authorized: false, errorMessage: '' })
    if (!token) { this.deny('请返回“我的”完成登录后再试。'); return }
    try {
      const access = await request<{ canReadFeedback: boolean }>('/feedback/maintenance/access')
      // If credentials changed, discard this response and authorize under the new session.
      if (!this._alive || epoch !== this._epoch) return
      if (getAuth()?.accessToken !== token) { void this.authorize(); return }
      if (access.canReadFeedback !== true) { this.deny('当前账号没有反馈管理权限。'); return }
      this.setData({ authorized: true, checking: false })
      if (this.data.mode === 'DETAIL') await this.loadDetail(epoch)
      else { void this.loadModules(epoch); if (!this._loaded) await this.loadList(true) }
    } catch (error) { if (this._alive && epoch === this._epoch) this.deny(feedbackError(error)) }
  },
  async loadModules(epoch: number) {
    try { const response = await request<{ modules: FeedbackModule[] }>('/feedback/modules'); if (this.current(epoch)) this.setData({ modules: copyModules(response.modules), moduleError: '' }) }
    catch { if (this.current(epoch)) this.setData({ moduleError: '功能位置暂不可选，可继续按时间查看。' }) }
  },
  async loadList(reset: boolean) {
    if (!this.data.authorized || (!reset && (this.data.loading || this.data.loadingMore || !this.data.nextCursor))) return
    const epoch = this._epoch, sequence = ++this._listSequence
    const cursor = reset ? '' : this.data.nextCursor
    if (reset) { this._loaded = false; this.setData({ items: [], nextCursor: '', loading: true, loadingMore: false }) }
    else this.setData({ loadingMore: true })
    this.setData({ errorMessage: '' })
    const current = () => this.current(epoch) && sequence === this._listSequence
    const query = '?range=' + this.data.range + (this.data.moduleCode ? '&module=' + encodeURIComponent(this.data.moduleCode) : '') + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')
    try {
      const response = await request<{ items: FeedbackSummary[]; nextCursor: string | null }>('/feedback/maintenance/list' + query)
      if (!current()) return
      const mapped = response.items.map(item => ({ ...item, location: locationLabel(item.modulePath), time: submittedLabel(item.submittedAt) }))
      const items = reset ? mapped : [...this.data.items, ...mapped.filter(item => !this.data.items.some(old => old.feedbackId === item.feedbackId))]
      this._loaded = true; this.setData({ items, nextCursor: response.nextCursor || '' })
    } catch (error) {
      if (!current()) return
      if (error instanceof ApiError && (error.statusCode === 401 || error.statusCode === 403)) this.deny(feedbackError(error))
      else this.setData({ errorMessage: feedbackError(error) })
    } finally { if (current()) this.setData({ loading: false, loadingMore: false, refreshing: false }) }
  },
  more() { void this.loadList(false) },
  refresh() { this.setData({ refreshing: true }); void this.loadList(true) },
  retry() { if (!this.data.authorized) void this.authorize(); else if (this.data.mode === 'DETAIL') void this.loadDetail(this._epoch); else void this.loadList(!this._loaded) },
  chooseRange(e: WechatMiniprogram.TouchEvent) {
    const range = String(e.currentTarget.dataset.key)
    if (!this.data.ranges.some(item => item.key === range) || range === this.data.range) return
    this.setData({ range }); void this.loadList(true)
  },
  openModulePicker() { if (this.data.modules.length) this.setData({ showModulePicker: true, moduleTrail: [], moduleOptions: copyModules(this.data.modules) }) },
  closeModulePicker() { this.setData({ showModulePicker: false }) }, stopTap() {},
  chooseModule(e: WechatMiniprogram.TouchEvent) {
    const item = this.data.moduleOptions.find(n => n.code === e.currentTarget.dataset.code); if (!item) return
    this.setData({ moduleTrail: copyModules([...this.data.moduleTrail, item]), moduleOptions: copyModules(item.children || []) })
    if (!item.children?.length) this.commitModule()
  },
  moduleLevel(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index); if (!Number.isInteger(index) || index < -1 || index >= this.data.moduleTrail.length) return
    const trail = this.data.moduleTrail.slice(0, index + 1)
    this.setData({ moduleTrail: copyModules(trail), moduleOptions: copyModules(trail.length ? trail[trail.length - 1].children || [] : this.data.modules) })
  },
  commitModule() {
    const last = this.data.moduleTrail[this.data.moduleTrail.length - 1]; if (!last) return
    this.setData({ moduleCode: last.code, moduleLabel: this.data.moduleTrail.map(n => n.name).join(' › '), showModulePicker: false }); void this.loadList(true)
  },
  clearModule() { this.setData({ moduleCode: '', moduleLabel: '', showModulePicker: false }); void this.loadList(true) },
  openDetail(e: WechatMiniprogram.TouchEvent) { if (this.data.authorized) openPage('/pages/feedback-management/feedback-management?id=' + encodeURIComponent(String(e.currentTarget.dataset.id))) },
  async loadDetail(epoch: number) {
    this.clearImages(); this.setData({ loading: true, detail: null, pictures: [], errorMessage: '', showEnvironment: false })
    try {
      const detail = await request<FeedbackDetail>('/feedback/maintenance/' + encodeURIComponent(this.data.feedbackId))
      if (!this.current(epoch)) return
      const environment = detail.context.environment
      this.setData({ detail, detailLocation: locationLabel(detail.modulePath), detailTime: submittedLabel(detail.submittedAt), environmentLabel: environment === 'develop' ? '开发版' : environment === 'trial' ? '体验版' : environment === 'release' ? '正式版' : environment || '未记录', pictures: detail.images.map(image => ({ id: image.attachmentId, path: '', loading: false, failed: false })) })
      let next = 0
      const worker = async () => { while (next < detail.images.length && this.current(epoch)) await this.loadPicture(detail.images[next++]!.attachmentId, epoch) }
      void Promise.all([worker(), worker()])
    } catch (error) { if (this.current(epoch)) this.setData({ errorMessage: feedbackError(error) }) }
    finally { if (this.current(epoch)) this.setData({ loading: false }) }
  },
  async loadPicture(id: string, epoch: number) {
    const update = (values: Partial<Picture>) => { if (this.current(epoch)) this.setData({ pictures: this.data.pictures.map(p => p.id === id ? { ...p, ...values } : p) }) }
    update({ loading: true, failed: false })
    try {
      const path = await downloadFeedbackImage(id)
      if (!this.current(epoch)) { removeFeedbackImage(path); return }
      this._files.add(path); update({ path, loading: false })
    } catch { update({ loading: false, failed: true }) }
  },
  preview(e: WechatMiniprogram.TouchEvent) {
    const picture = this.data.pictures.find(p => p.id === e.currentTarget.dataset.id); if (!picture || picture.loading) return
    if (!picture.path) { void this.loadPicture(picture.id, this._epoch); return }
    wx.previewImage({ current: picture.path, urls: this.data.pictures.filter(p => p.path).map(p => p.path) })
  },
  copyContact() { if (this.data.detail?.contact) wx.setClipboardData({ data: this.data.detail.contact }) },
  copyId() { if (this.data.detail) wx.setClipboardData({ data: this.data.detail.feedbackId }) },
  toggleEnvironment() { this.setData({ showEnvironment: !this.data.showEnvironment }) },
  goBack() { backPage(this.data.mode === 'DETAIL' ? '/pages/feedback-management/feedback-management' : '/pages/profile/profile', this) },
})
