import { ApiError, request } from '../../utils/api'
import { ensureSessionContext, SessionContext, SubjectSummary } from '../../utils/session'

interface ReportSummary {
  periodStart: string
  coverageRatio: string
  warnings: string[]
  result: { assessment: { status: string; nutrients: Array<{ nutrientCode: string; status: string; coverageRatio: string }> } }
}
const nutrientNames: Record<string, string> = {
  PROTEIN: '蛋白质', CALCIUM: '钙', IRON: '铁', VITAMIN_A_RAE: '维生素A',
  VITAMIN_C: '维生素C', CARBOHYDRATE: '碳水', FIBER_DIETARY: '膳食纤维', ZINC: '锌',
}
const statusLabels: Record<string, string> = {
  AT_OR_ABOVE_REFERENCE: '达到参考值', BELOW_REFERENCE: '低于参考值（非诊断）', ABOVE_UPPER_LIMIT: '高于上限参考',
  INSUFFICIENT_COVERAGE: '覆盖不足', NO_INTAKE_DATA: '暂无数据', NO_REFERENCE_VALUE: '无参考值', UNIT_MISMATCH: '单位不匹配',
}
const warningLabels: Record<string, string> = {
  NO_CONFIRMED_INTAKE: '本时段没有已确认的实际摄入记录',
  NO_NUTRIENT_DATA: '本时段暂无可用于计算的营养数据',
  NO_INTAKE_DATA: '没有已确认的摄入数据',
  INSUFFICIENT_COVERAGE: '数据覆盖不足，暂不作参考值比较',
  NO_REFERENCE_VALUE: '当前规则没有提供适用参考值',
  UNIT_MISMATCH: '摄入数据与参考规则单位不一致',
}
function warningLabel(warning: string): string {
  const [nutrientCode, code] = warning.split(':')
  if (code) return `${nutrientNames[nutrientCode] || nutrientCode}：${warningLabels[code] || code}`
  return warningLabels[warning] || warning
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
  return app.globalData.ready || ensureSessionContext()
}

Component({
  data: {
    loading: true, babyName: '宝宝', genderText: '', ageText: '', warnings: [] as string[],
    reportTitle: '今天还没有营养报告', reportDescription: '记录并确认实际摄入后生成营养参考',
    nutrients: [] as Array<{ name: string; value: number; state: string; color: string; warn: boolean }>,
    advice: [] as Array<{ tone: string; badge: string; title: string; description: string }>,
  },
  pageLifetimes: { show() { void this.load() } },
  methods: {
    async load() {
      this.setData({ loading: true })
      try {
        const active = await context()
        if (!active.subjectId) throw new Error('请先建立宝宝档案')
        const [subject, reports] = await Promise.all([
          request<SubjectSummary>(`/subjects/${active.subjectId}`),
          request<ReportSummary[]>(`/subjects/${active.subjectId}/assessment-reports`),
        ])
        const today = new Date()
        const todayKey = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`
        const report = reports.find((item) => item.periodStart === todayKey)
        const assessment = report?.result.assessment
        const coverage = report ? Math.round(Number(report.coverageRatio) * 100) : 0
        const nutrients = (assessment?.nutrients || []).filter((item) => nutrientNames[item.nutrientCode]).slice(0, 4).map((item) => ({
          name: nutrientNames[item.nutrientCode] || item.nutrientCode,
          value: Math.round(Number(item.coverageRatio) * 100),
          state: statusLabels[item.status] || item.status,
          color: item.status === 'AT_OR_ABOVE_REFERENCE' ? '#73c959' : item.status === 'ABOVE_UPPER_LIMIT' ? '#ef6c64' : '#f6a623',
          warn: item.status !== 'AT_OR_ABOVE_REFERENCE' && item.status !== 'WITHIN_UPPER_LIMIT',
        }))
        const advice = (coverage > 0 ? nutrients : []).slice(0, 3).map((item) => ({
          tone: item.color === '#73c959' ? 'vegetable' : 'grain', badge: item.name.slice(0, 1),
          title: item.name, description: item.state,
        }))
        this.setData({
          babyName: subject.displayName, genderText: subject.sex === 'FEMALE' ? '女' : subject.sex === 'MALE' ? '男' : '',
          ageText: ageLabel(subject.birthDate),
          reportTitle: report ? '今日营养报告已生成' : '今天还没有营养报告',
          reportDescription: report ? '查看已记录摄入、主要来源和参考信息' : '记录并确认实际摄入后生成营养参考',
          warnings: (report?.warnings || []).map(warningLabel), nutrients,
          advice: advice.length ? advice : [{ tone: 'grain', badge: '记', title: '尚无报告结论', description: '先记录并确认实际摄入，再查看营养参考' }],
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
        wx.navigateTo({ url: '/pages/camera/camera' })
      } catch (caught) {
        const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '创建餐食失败'
        wx.showToast({ title: message, icon: 'none' })
      } finally { this.setData({ loading: false }) }
    },
    openReport() { wx.redirectTo({ url: '/pages/report/report' }) },
    openProfile() { wx.redirectTo({ url: '/pages/profile/profile' }) },
    showNotice() { wx.showToast({ title: this.data.warnings[0] || '今天没有新的数据警告', icon: 'none' }) },
  },
})
