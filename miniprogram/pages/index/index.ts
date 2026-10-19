import {checkFamilyContext} from '../../utils/family-sync'
import { emptyHomeMenu, homeMenuPreview, homeMenuFeatured, chinaMenuDates, nextMenuSlotRefreshIn } from '../../utils/home-menu'
import type { MenuLatest } from '../../utils/diet-plan'
import { openPage, navigateRoot } from '../../utils/navigation'
import { ApiError, request, getAuth, downloadPrivateRecipeImage } from '../../utils/api'
import { ageDisplay } from '../../utils/age'
import { ensureSessionContext, SessionContext, SubjectSummary } from '../../utils/session'

import { nutrientView, warningLabel, suspendReportComparison } from '../../utils/nutrition-report'
import type { AssessmentReport } from '../../utils/nutrition-report'
async function context(): Promise<SessionContext> {
  const app = getApp<IAppOption>()
  return app.globalData.ready || ensureSessionContext()
}

Component({
  options: { pureDataPattern: /^_homeMenu/ },
  data: { _homeMenuSequence: 0, _homeMenuVisible: false, _homeMenuTimer: 0, _homeMenuLatest: null as MenuLatest | null, reviewLabel:wx.getSystemInfoSync().platform==='devtools'?(wx.getStorageSync('foodmaster.reviewEnvironment')?.label || ''):'',
    homeMenuDateLabel:'',homeMenuTitle:'饮食推荐',homeMenuFeatured:null as ReturnType<typeof homeMenuFeatured>,homeMenuImage:'/assets/camera-food-guide-v5.jpg',_homeMenuImageKey:'',_homeMenuImageSession:'',_homeMenuImageFiles:{} as Record<string,string>,
    homeScrollHeight: 0, homeMenuSubjectId: '', homeMenu: emptyHomeMenu('LOADING', '正在查看饮食搭配…', ''),
    loading: true, babyName: '宝宝', genderText: '', ageText: '', warnings: [] as string[],
    reportTitle: '今天还没有营养报告', reportDescription: '记录并确认实际摄入后生成营养参考',
    nutrients: [] as Array<{ name: string; value: number; state: string; color: string; warn: boolean }>,
    advice: [] as Array<{ tone: string; badge: string; title: string; description: string; nutrientCode?:string; reportId?:string }>,
  },
  pageLifetimes: { show() { this.startHomeMenu() }, hide() { this.stopHomeMenu() }, resize() { this.updateHomeScrollHeight() } },
  lifetimes: { detached() { this.stopHomeMenu() } },
  methods: {
    onShow() { this.startHomeMenu() },
    onResize() { this.updateHomeScrollHeight() },
    updateHomeScrollHeight() {
      wx.nextTick(() => {
        if (!this.data._homeMenuVisible) return
        this.createSelectorQuery().select('.home-scroll').boundingClientRect(rect => {
          if (!rect || Array.isArray(rect)) return
          this.setData({ homeScrollHeight: Math.max(1, wx.getSystemInfoSync().windowHeight - rect.top) })
        }).exec()
      })
    },
    onHide() { this.stopHomeMenu() },
    onUnload() { this.stopHomeMenu() },
    startHomeMenu() {
      void checkFamilyContext()
      if (this.data._homeMenuVisible) return
      this.setData({ _homeMenuVisible: true })
      this.updateHomeScrollHeight()
      void this.load()
      void this.loadHomeMenu()
    },
    stopHomeMenu() {
      this.setData({ _homeMenuVisible: false, _homeMenuSequence: this.data._homeMenuSequence + 1 })
      clearTimeout(this.data._homeMenuTimer)
    },
    async loadHomeMenu() {
      const seq = this.data._homeMenuSequence + 1
      this.setData({ _homeMenuSequence: seq })
      clearTimeout(this.data._homeMenuTimer)
      const cached = this.data._homeMenuLatest
      const sameBaby = this.data.homeMenuSubjectId === getApp<IAppOption>().globalData.subjectId
      if (cached && sameBaby && this.data.homeMenu.state === 'READY') {
        this.presentHomeMenu(cached,seq,false)
      } else {
        this.setData({ _homeMenuLatest: null })
        this.setData({ homeMenuSubjectId: '', homeMenu: emptyHomeMenu('LOADING', '正在查看饮食搭配…', ''),homeMenuTitle:'饮食推荐',homeMenuFeatured:null,homeMenuImage:'/assets/camera-food-guide-v5.jpg',_homeMenuImageKey:'' })
      }
      let subjectId = ''
      try {
        const active = await context(), app = getApp<IAppOption>()
        if (seq !== this.data._homeMenuSequence || !this.data._homeMenuVisible) return
        subjectId = app.globalData.subjectId || active.subjectId || ''
        if (!subjectId) {
          this.setData({ homeMenu: emptyHomeMenu('PROFILE', '先建立宝宝档案，再规划饮食搭配', '建立档案'),homeMenuFeatured:null,homeMenuImage:'/assets/camera-food-guide-v5.jpg',_homeMenuImageKey:'' })
          return
        }
        if (!active.subjects.some(s => s.subjectId === subjectId)) throw new Error('宝宝会话已变更')
        this.setData({ homeMenuSubjectId: subjectId })
        const latest = await request<MenuLatest>(`/subjects/${subjectId}/diet-plans/latest`)
        if (seq !== this.data._homeMenuSequence || !this.data._homeMenuVisible) return
        if (getApp<IAppOption>().globalData.subjectId !== subjectId) { void this.loadHomeMenu(); return }
        this.setData({ _homeMenuLatest: latest })
        const homeMenu = homeMenuPreview(latest)
        this.presentHomeMenu(latest,seq)
        const nextRefresh = Math.min(chinaMenuDates().refreshIn, nextMenuSlotRefreshIn())
        const delay = homeMenu.generating ? Math.min(5000, nextRefresh) : nextRefresh
        this.setData({ _homeMenuTimer: setTimeout(() => { if (this.data._homeMenuVisible) void this.loadHomeMenu() }, delay) as unknown as number })
      } catch {
        if (seq !== this.data._homeMenuSequence || !this.data._homeMenuVisible) return
        if (subjectId && getApp<IAppOption>().globalData.subjectId !== subjectId) { void this.loadHomeMenu(); return }
        this.setData({ homeMenu: emptyHomeMenu('ERROR', '搭配暂时未能加载', '重新加载'),homeMenuFeatured:null,homeMenuImage:'/assets/camera-food-guide-v5.jpg',_homeMenuImageKey:'' })
      }
    },
    presentHomeMenu(latest:MenuLatest,seq:number,readImage=true) {
      const now=Date.now(),preview=homeMenuPreview(latest,now),featured=homeMenuFeatured(latest,preview,now),session=getAuth()?.clientSessionId||'';
      const key=featured?[session,preview.taskId,preview.date,featured.recipeKey].join(':'):'';
      const same=key===this.data._homeMenuImageKey&&session===this.data._homeMenuImageSession;
      this.setData({homeMenu:preview,homeMenuDateLabel:preview.dateLabel.replace(/^今日/,'今天').replace(/^明日/,'明天'),homeMenuTitle:preview.state==='READY'&&/^(今日|明日)/.test(preview.dateLabel)?preview.dateLabel.slice(0,2)+'饮食推荐':'饮食推荐',homeMenuFeatured:featured,homeMenuImage:same?this.data.homeMenuImage:'/assets/camera-food-guide-v5.jpg',_homeMenuImageKey:key,_homeMenuImageSession:session,...(session!==this.data._homeMenuImageSession?{_homeMenuImageFiles:{}}:{})});
      if(readImage&&featured)void this.loadHomeMenuImage(preview,featured,seq,key,session);
    },
    async loadHomeMenuImage(preview:ReturnType<typeof homeMenuPreview>,featured:NonNullable<ReturnType<typeof homeMenuFeatured>>,seq:number,key:string,session:string) {
      const subject=this.data.homeMenuSubjectId;
      const current=()=>seq===this.data._homeMenuSequence&&this.data._homeMenuVisible&&key===this.data._homeMenuImageKey&&subject===getApp<IAppOption>().globalData.subjectId&&session===(getAuth()?.clientSessionId||'');
      try {
        // Read existing status only. Opening home must never dispatch image generation.
        const image=await request<{url:string|null}>('/diet-plan-tasks/'+encodeURIComponent(preview.taskId)+'/recipes/'+encodeURIComponent(featured.recipeKey)+'/image');
        if(!current())return;
        if(!image.url){this.setData({homeMenuImage:'/assets/camera-food-guide-v5.jpg'});return}
        const cached=this.data._homeMenuImageFiles[image.url],file=cached||await downloadPrivateRecipeImage(image.url);
        if(!current())return;
        this.setData({homeMenuImage:file,_homeMenuImageFiles:{...this.data._homeMenuImageFiles,[image.url]:file}});
      } catch {if(current())this.setData({homeMenuImage:'/assets/camera-food-guide-v5.jpg'})}
    },
    onHomeMenuImageError(e:WechatMiniprogram.CustomEvent) {if(e.currentTarget.dataset.src===this.data.homeMenuImage&&this.data.homeMenuImage!=='/assets/camera-food-guide-v5.jpg')this.setData({homeMenuImage:'/assets/camera-food-guide-v5.jpg',_homeMenuImageFiles:{}})},
    openHomeMenuWeek() {this.openHomeMenu(true)},
    openHomeMenu(overview?:unknown) {
      if (this.data.homeMenu.state === 'LOADING') return
      if (this.data.homeMenu.state === 'ERROR') { void this.loadHomeMenu(); return }
      if (this.data.homeMenu.state === 'PROFILE') { this.openProfile(); return }
      const subjectId = this.data.homeMenuSubjectId
      if (!subjectId || getApp<IAppOption>().globalData.subjectId !== subjectId) { void this.loadHomeMenu(); return }
      const preview = this.data.homeMenu
      const dates = chinaMenuDates()
      if (preview.state === 'READY' && preview.date !== dates.today && preview.date !== dates.tomorrow) { void this.loadHomeMenu(); return }
      const target = preview.state === 'READY' && overview!==true ? `&date=${encodeURIComponent(preview.date)}&planId=${encodeURIComponent(preview.taskId)}` : ''
      openPage(`/pages/diet-menu/diet-menu?subjectId=${encodeURIComponent(subjectId)}${target}`)
    },

    async load() {
      this.setData({ loading: true })
      try {
        const active = await context()
        if (!active.subjectId) throw new Error('请先建立宝宝档案')
        const [subject, reports] = await Promise.all([
          request<SubjectSummary>(`/subjects/${active.subjectId}`),
          request<AssessmentReport[]>(`/subjects/${active.subjectId}/assessment-reports`),
        ])
        const today = new Date()
        const todayKey = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`
        const savedReport = reports.find((item) => item.periodStart === todayKey)
        const report = savedReport ? suspendReportComparison(savedReport) : undefined
        const reportNeedsRefresh = Boolean(wx.getStorageSync('foodmaster.reportNeedsRefresh'))
        const legacyReport = Boolean(report && !report.result.evidence)
        const assessment = report?.result.assessment
        const nutrients = (assessment?.nutrients || []).map(item => { const view=nutrientView(item,[]);return {name:view.name,value:0,state:view.statusText,color:'#817570',warn:false,nutrientCode:item.nutrientCode} })
        const advice = (!reportNeedsRefresh && !legacyReport && report?.result.evidence?.records.length ? nutrients : []).slice(0,3).map(item=>({tone:'grain',badge:item.name.slice(0,1),title:item.name,description:item.state,nutrientCode:item.nutrientCode,reportId:report!.reportId}))
        this.setData({
          babyName: subject.displayName, genderText: subject.sex === 'FEMALE' ? '女' : subject.sex === 'MALE' ? '男' : '',
          ageText: ageDisplay(subject.birthDate),
          reportTitle: legacyReport ? '今日报告暂不支持新版解读' : reportNeedsRefresh ? '今日营养报告待更新' : report ? '今日营养报告已生成' : '今天还没有营养报告',
          reportDescription: legacyReport ? '已保存餐食不受影响，可在记录页查看；报告页将说明当前兼容限制' : reportNeedsRefresh ? '新记录已保存，打开报告生成最新营养参考' : report ? '看看食物带来了哪些营养' : '记录并确认实际摄入后生成营养参考',
          warnings: reportNeedsRefresh || legacyReport ? [] : (report?.warnings || []).map(warningLabel),
          nutrients: reportNeedsRefresh || legacyReport ? [] : nutrients,
          advice: advice.length ? advice : [{
            tone: 'grain', badge: '记',
            title: legacyReport ? '报告暂不支持新版解读' : reportNeedsRefresh ? '报告等待更新' : '尚无报告结论',
            description: legacyReport ? '已保存餐食可在记录页查看' : reportNeedsRefresh ? '打开今日营养报告即可生成最新结果' : '先记录并确认实际摄入，再查看营养参考',
          }],
        })
      } catch (caught) {
        const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '首页加载失败'
        this.setData({ reportTitle: '今日报告暂不可用', reportDescription: message, advice: [{ tone: 'grain', badge: '!', title: '数据暂不可用', description: message }] })
      } finally { this.setData({ loading: false }) }
    },
    async openCamera() {
      if (this.data.loading) return
      this.setData({ loading: true })
      try {
        const active = await context()
        if (!active.subjectId) throw new Error('请先建立宝宝档案')
        openPage('/pages/camera/camera')
      } catch (caught) {
        const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '创建餐食失败'
        wx.showToast({ title: message, icon: 'none' })
      } finally { this.setData({ loading: false }) }
    },
    openAdvice(e:WechatMiniprogram.TouchEvent) { const row=this.data.advice[Number(e.currentTarget.dataset.index)]; if(row?.reportId&&row.nutrientCode)openPage('/pages/nutrient-detail/nutrient-detail?code='+encodeURIComponent(row.nutrientCode)+'&reportId='+encodeURIComponent(row.reportId)) },
    openReport() { openPage('/pages/report/report') },
    openProfile() { navigateRoot('/pages/profile/profile') },
    showNotice() { wx.showToast({ title: this.data.warnings[0] || '今天没有新的数据警告', icon: 'none' }) },
  },
})
