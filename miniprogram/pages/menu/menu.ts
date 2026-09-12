import { ApiError, request } from '../../utils/api'
import { ensureSessionContext, SessionContext, SubjectSummary } from '../../utils/session'

interface RecipeSummary {
  recipeId: string
  name: string
  description: string | null
  status: 'DRAFT' | 'PUBLISHED'
  revision: number | null
  finishedWeightGrams: string | null
  yieldMeasurementMethod: string | null
}
interface MenuCandidate {
  recipeId: string
  recipeRevisionId: string
  name: string
  ageTags: Array<{ ageFromMonths: number; ageToMonthsExclusive: number }>
  foodIds: string[]
}
interface CandidateResponse {
  ageMonths: number
  candidates: MenuCandidate[]
  excludedRecipeIds: string[]
  mode: 'CANDIDATE_ONLY'
  period: 'DAY'
  notice: string
  caregiverNotice: string
}
interface Avoidance { foodId: string; foodName: string; reason: string | null }

function ageMonths(birthDate: string): number {
  const birth = new Date(`${birthDate}T00:00:00`)
  const today = new Date()
  let months = (today.getFullYear() - birth.getFullYear()) * 12 + today.getMonth() - birth.getMonth()
  if (today.getDate() < birth.getDate()) months -= 1
  return Math.max(0, months)
}
async function context(): Promise<SessionContext> {
  const app = getApp<IAppOption>()
  return app.globalData.ready || ensureSessionContext()
}
function grams(value: string | null): string {
  if (!value) return '尚无实测成品重量'
  return `${Number(value).toString()} 克成品`
}

Page({
  data: {
    loading: true, babyName: '宝宝', ageText: '', error: '', notice: '仅供内部学习参考，不是医学诊断或喂养处方',
    caregiverNotice: '需由照护者确认食材适用性', excludedCount: 0,
    candidates: [] as Array<MenuCandidate & { ageLabel: string; ingredientCount: number }>,
    recipes: [] as Array<RecipeSummary & { statusLabel: string; weightLabel: string }>,
    avoidances: [] as Avoidance[],
  },

  onShow() { void this.load() },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const active = await context()
      if (!active.householdId || !active.subjectId) throw new Error('请先建立家庭和宝宝档案')
      const subject = await request<SubjectSummary>(`/subjects/${active.subjectId}`)
      const months = ageMonths(subject.birthDate)
      if (months < 6 || months >= 24) throw new Error('菜单候选当前仅适用于 6～24 个月宝宝')
      const [recipes, result, avoidances] = await Promise.all([
        request<RecipeSummary[]>(`/households/${active.householdId}/recipes`),
        request<CandidateResponse>(`/households/${active.householdId}/menu-candidates?ageMonths=${months}&limit=50`),
        request<Avoidance[]>(`/households/${active.householdId}/food-avoidances`),
      ])
      this.setData({
        babyName: subject.displayName, ageText: `${months}个月`, notice: result.notice,
        caregiverNotice: result.caregiverNotice, excludedCount: result.excludedRecipeIds.length, avoidances,
        candidates: result.candidates.map((item) => ({
          ...item, ingredientCount: item.foodIds.length,
          ageLabel: item.ageTags.map((tag) => `${tag.ageFromMonths}～${tag.ageToMonthsExclusive}月`).join('、'),
        })),
        recipes: recipes.map((item) => ({
          ...item, statusLabel: item.status === 'PUBLISHED' ? '已发布' : '草稿',
          weightLabel: grams(item.finishedWeightGrams),
        })),
      })
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '菜单候选加载失败'
      this.setData({ error: message })
      wx.showToast({ title: message, icon: 'none' })
    } finally { this.setData({ loading: false }) }
  },
  goBack() { wx.navigateBack() },
  explainCandidate() { wx.showToast({ title: '候选不会自动记为实际摄入', icon: 'none' }) },
})
