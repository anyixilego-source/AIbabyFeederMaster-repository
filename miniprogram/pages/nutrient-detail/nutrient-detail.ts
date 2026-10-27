import type {SpecialReferenceView} from '../../utils/nutrient-special-reference'
import { detailComparison } from '../../utils/nutrient-detail-visual'
import { foodCards } from '../../utils/nutrient-detail-view'
import { backPage,replacePage } from '../../utils/navigation'
import {canRecordBaby} from '../../utils/family-state'
import { ApiError, reviewEnvironment } from '../../utils/api'
import { formatNumber, loadReportBundle } from '../../utils/nutrition-report'
import { categories, category } from '../../utils/nutrition-period'
import type { ReportBundle } from '../../utils/nutrition-report'
import type { NutrientView } from '../../utils/nutrition-report'
import { ensureSessionContext } from '../../utils/session'
import type { SessionContext } from '../../utils/session'

async function context(): Promise<SessionContext> {
  const app = getApp<IAppOption>()
  return app.globalData.ready || ensureSessionContext()
}

function referencePresentation(nutrient: NutrientView) {
  const suspended = ['CARBOHYDRATE', 'VITAMIN_A_RAE', 'FOLATE', 'IODINE'].includes(nutrient.nutrientCode) && !nutrient.referenceSourceApproved
  const recommended = nutrient.recommendedValue === null ? null : Number(nutrient.recommendedValue)
  const upper = nutrient.upperLimitValue === null ? null : Number(nutrient.upperLimitValue)
  const lowerRange = nutrient.rangeLowerValue === null ? null : Number(nutrient.rangeLowerValue)
  const upperRange = nutrient.rangeUpperValue === null ? null : Number(nutrient.rangeUpperValue)
  const hasRange = lowerRange !== null && upperRange !== null
  const isEnergyEstimate = nutrient.referenceType === 'EER'
  const isCarbEstimate = nutrient.referenceType === 'AMDR_DERIVED'
  const current = nutrient.numericValue || 0
  let referenceText = suspended ? '数据口径或覆盖待核对，暂不展示参考值' : '当前规则未提供适用参考值'
  let scaleMax = Math.max(current, 1)
  if (hasRange) {
    referenceText = isCarbEstimate
      ? `按一般能量需要量估算：${formatNumber(lowerRange)}–${formatNumber(upperRange)} ${nutrient.unitText}/日`
      : `一般参考区间 ${formatNumber(lowerRange)}–${formatNumber(upperRange)} ${nutrient.unitText}/日`
    scaleMax = Math.max(upperRange * 1.25, current, 1)
  } else if (recommended !== null && upper !== null) {
    referenceText = `一般参考值 ${formatNumber(recommended)}；上限参考 ${formatNumber(upper)} ${nutrient.unitText}/日`
    scaleMax = Math.max(upper, current, 1)
  } else if (recommended !== null) {
    referenceText = `${isEnergyEstimate ? (nutrient.weightEnergy?'按体重估计需要量':'一般能量估计值') : nutrient.referenceType==='EAR' ? 'EAR背景参考（非达标线）' : nutrient.referenceType==='AI' ? '适宜摄入量参考（AI）' : '一般参考值'} ${formatNumber(recommended)} ${nutrient.unitText}/日`
    scaleMax = Math.max(recommended * 1.25, current, 1)
  } else if (upper !== null) {
    referenceText = `上限参考值 ${formatNumber(upper)} ${nutrient.unitText}/日`
    scaleMax = Math.max(upper, current, 1)
  }
  const markerPercent = Math.max(0, Math.min(100, Math.round(current / scaleMax * 10000) / 100))
  return {
    referenceText:nutrient.specialReferenceView?'':referenceText, markerPercent, scaleMaxText: formatNumber(scaleMax), informationalMarker: hasRange && nutrient.referenceType === 'AI_RANGE', currentMarkerText: (nutrient.dataNote ? '已知部分 ' : '已记录 ') + nutrient.amountText,
    referenceAvailable: !suspended && (nutrient.outputEligibility === 'FULL_COMPARISON' || (hasRange && nutrient.referenceType === 'AI_RANGE')),
    hasRange, rangeLowerText: lowerRange === null ? '' : formatNumber(lowerRange), rangeUpperText: upperRange === null ? '' : formatNumber(upperRange),
    rangeStartPercent: hasRange ? Math.round(lowerRange / scaleMax * 10000) / 100 : 0,
    rangeWidthPercent: hasRange ? Math.round((upperRange - lowerRange) / scaleMax * 10000) / 100 : 0,
    showCurrentMarker: !suspended && (nutrient.outputEligibility === 'FULL_COMPARISON' || (hasRange && nutrient.referenceType === 'AI_RANGE' && nutrient.outputEligibility === 'REFERENCE_ONLY')) && !isCarbEstimate && nutrient.numericValue !== null && Number.isFinite(nutrient.numericValue) && nutrient.numericValue >= 0
      && nutrient.status !== 'UNIT_MISMATCH' && nutrient.status !== 'INSUFFICIENT_COVERAGE',
    referenceMainText:nutrient.specialReferenceView?(nutrient.specialReferenceView.kind==='FAT_ENERGY_SHARE'?'按已记录脂肪与能量计算供能比':'适宜摄入参考与控制方向分别展示'):suspended ? '目前仅展示可计算的已记录量' : hasRange ? '两端为AI参考区间的下端和上端' : isEnergyEstimate
      ? (nutrient.weightEnergy?'按已记录体重与测量日期估计的能量需要量':'按月龄和性别估计的一般能量需要量') : nutrient.referenceType === 'RNI' ? '已记录量与RNI推荐摄入量对照' : '参考类型：'+nutrient.referenceLabel+'（仅供了解）',
    referenceSubText:nutrient.specialReferenceView?(nutrient.specialReferenceView.kind==='FAT_ENERGY_SHARE'?'脂肪克数×9千卡/克÷同批已记录能量×100%；任一项资料不足不计算。参考区间不作达标判断。':'AI不是需要达到的最低值；PI-NCD不是AI上界，不据此建议加盐或判断医学风险。'):suspended ? '来源定义或食品覆盖仍待核对，不据此判断摄入是否充足。' : isCarbEstimate
      ? '由能量供能比推算；食品碳水口径待核对，暂不判断达标。'
      : hasRange ? '区间上限不是安全摄入上限，也不是过量判断线。'
        : '仅供了解，不代表营养达标、缺乏或医学判断。',
    expandableConclusion: true,
  }
}

Page({
  data: {
    specialReferenceView:null as SpecialReferenceView,
    categories,category:'ALL',optionCategory:'ALL',showNutrientOptions:true,options:[] as Array<{code:string;name:string;category:string}>,visibleOptions:[] as Array<{code:string;name:string;category:string}>,
    comparisonAvailable:false,comparisonPercent:0,comparisonText:'—',comparisonColor:'neutral',comparisonStroke:'#d4c9bc',comparisonCaption:'仅展示记录量',
    reviewLabel:reviewEnvironment()?.label || '',foodCards:[] as ReturnType<typeof foodCards>,missingSources:[] as Array<{foodId:string;name:string;weight:string}>,loading: true,
    errorMessage: '',
    periodId:'',nutrientCode: '', reportId: '', dateLabel: '', referenceSource: '',
    name: '营养素',
    badge: '营',
    weightEditorVisible:false,weightSubjectId:'',weightEntryEnabled:false,weightEntryNote:'',weightEntryLabel:'补充体重',
    amountText: '—',
    unitText: '',
    sourceCount: 0,sourceSnapshotAvailable:false,hasValue:false,
    sources: [] as NutrientView['sources'],
    referenceText: '',
    referenceAvailable: false,
    hasRange: false, rangeLowerText:'',rangeUpperText:'',
    rangeStartPercent: 0,
    rangeWidthPercent: 0,
    showCurrentMarker: false, informationalMarker:false, currentMarkerText:'',
    referenceMainText: '',
    referenceSubText: '',
    expandableConclusion: false,
    markerPercent: 0,
    scaleMaxText: '',
    conclusion: '',
    conclusionTone: 'neutral',
    dataNote: '',
    conclusionExpanded: false,
    aboutExpanded: false,
    reasons: [] as string[],
    suggestions: [] as string[],
  },

  _weightRefreshDate:'',
  openWeight(){if(canRecordBaby())this.setData({weightEditorVisible:true})},
  closeWeight(){this.setData({weightEditorVisible:false})},
  weightSaved(e:WechatMiniprogram.CustomEvent<{reportDate:string}>){this.setData({weightEditorVisible:false});this._weightRefreshDate=e.detail.reportDate;void this.loadDetail()},
  _sequence:0,
  _bundle:null as ReportBundle|null,
  onHide(){++this._sequence;this.setData({weightEditorVisible:false})},
  onShow(){if(this.data.loading)void this.loadDetail()},
  onLoad(query: Record<string, string>) {
    this.setData({ periodId:query.periodId||'',nutrientCode: decodeURIComponent(query.code || ''), reportId: decodeURIComponent(query.reportId || '') })
    void this.loadDetail()
  },

  async loadDetail() {
    const sequence=++this._sequence
    this._bundle=null
    this.setData({ loading: true, errorMessage: '' })
    try {
      const active = await context()
      if (!active.subjectId) throw new Error('请先建立宝宝档案')
      const weightDate=this._weightRefreshDate;this._weightRefreshDate='';
      const bundle = await loadReportBundle(active.subjectId, !!weightDate, weightDate?'':this.data.reportId,weightDate)
      if(sequence===this._sequence)this.setData({weightSubjectId:active.subjectId})
      if(sequence!==this._sequence)return
      const nutrient = bundle.nutrients.find((item) => item.nutrientCode === this.data.nutrientCode)
      if (!nutrient) throw new Error('没有找到该营养素的报告数据')
      this._bundle=bundle
      const options=bundle.nutrients.map(n=>({code:n.nutrientCode,name:n.name,category:category(n.nutrientCode)}))
      const selectedCategory=category(nutrient.nutrientCode)
      this.setData({options,visibleOptions:options.filter(n=>n.category===selectedCategory),category:selectedCategory,optionCategory:selectedCategory})
      this.presentDetail()
    } catch (caught) {
      if(sequence!==this._sequence)return
      this._bundle=null
      this.setData({options:[],visibleOptions:[],comparisonAvailable:false,comparisonPercent:0,comparisonText:'—',foodCards:[],sources:[],missingSources:[],amountText:'—',hasValue:false,referenceAvailable:false,showCurrentMarker:false})
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '详情加载失败'
      this.setData({ errorMessage: message })
    } finally {
      if(sequence===this._sequence)this.setData({ loading: false })
    }
  },

  presentDetail() {
    const bundle=this._bundle
    const nutrient=bundle?.nutrients.find(n=>n.nutrientCode===this.data.nutrientCode)
    if(!bundle||!nutrient)return
      const reference = referencePresentation(nutrient)
      const comparison = detailComparison(nutrient)
      const reasons = [nutrient.statusText]
      if (nutrient.dataNote) reasons.push(nutrient.dataNote + '，当前结果只代表已知部分。')
      const suggestions = ['本页只解释这一修订的记录量，不从单日结果推断营养状况。']
      this.setData({
        ...comparison,specialReferenceView:nutrient.specialReferenceView||null,
        weightEntryEnabled:nutrient.nutrientCode==='ENERGY_KCAL'&&(bundle.report.result.evidence?.ageMonths??-1)>=6&&(bundle.report.result.evidence?.ageMonths??-1)<12&&canRecordBaby(),
        weightEntryNote:nutrient.weightEnergy?('采用'+Number(nutrient.weightEnergy.weightKg)+'公斤 · 测量于'+nutrient.weightEnergy.measuredOn):'',weightEntryLabel:nutrient.weightEnergy?'修改体重':'补充体重',
        name: nutrient.name,
        badge: nutrient.badge,
        amountText: nutrient.amountText,
        unitText: nutrient.unitText,
        sourceCount: nutrient.sources.length,sourceSnapshotAvailable:bundle.snapshotAvailable,hasValue:nutrient.numericValue!==null,
        sources: nutrient.sources,foodCards:foodCards(nutrient,bundle.report.result.evidence),
        missingSources: (bundle.report.result.evidence?.records || []).filter(r=>(bundle.report.result.evidence?.facts || []).some(f=>f.mealItemId===r.mealItemId&&f.nutrientCode===nutrient.nutrientCode&&f.contribution===null)).map(r=>({foodId:r.mealItemId,name:r.name,weight:(r.weightOrigin==='USER_ACCEPTED_ESTIMATE'?'约':'')+formatNumber(Number(r.consumedGrams))})),
        reportId:bundle.report.reportId,dateLabel: bundle.date, referenceSource: nutrient.referenceSource,
        referenceText: reference.referenceText,
        referenceAvailable: reference.referenceAvailable,
        hasRange: reference.hasRange,rangeLowerText:reference.rangeLowerText,rangeUpperText:reference.rangeUpperText,
        rangeStartPercent: reference.rangeStartPercent,
        rangeWidthPercent: reference.rangeWidthPercent,
        showCurrentMarker: reference.showCurrentMarker,informationalMarker:reference.informationalMarker,currentMarkerText:reference.currentMarkerText,
        referenceMainText: reference.referenceMainText,
        referenceSubText: reference.referenceSubText,
        expandableConclusion: reference.expandableConclusion,
        markerPercent: reference.markerPercent,
        scaleMaxText: reference.scaleMaxText,
        conclusion: nutrient.statusText,
        conclusionTone: nutrient.statusTone,
        dataNote: nutrient.dataNote,
        reasons,
        suggestions,
      })
    this.setData({category:category(nutrient.nutrientCode)})
  },
  selectCategory(e:WechatMiniprogram.TouchEvent) {
    if(this.data.loading||this.data.errorMessage)return
    const key=String(e.currentTarget.dataset.key)
    if(!this.data.categories.some(item=>item.key===key))return
    this.setData({optionCategory:key,showNutrientOptions:!this.data.showNutrientOptions||this.data.optionCategory!==key,visibleOptions:key==='ALL'?this.data.options:this.data.options.filter(n=>n.category===key)})
  },
  selectNutrient(e:WechatMiniprogram.TouchEvent) {
    if(this.data.loading||this.data.errorMessage||!this._bundle)return
    const code=String(e.currentTarget.dataset.code)
    if(!this.data.visibleOptions.some(n=>n.code===code)||!this._bundle.nutrients.some(n=>n.nutrientCode===code))return
    this.setData({nutrientCode:code,aboutExpanded:false,conclusionExpanded:false})
    this.presentDetail()
  },
  changePeriodMode(e:WechatMiniprogram.CustomEvent<{mode:string}>){if(e.detail.mode==='TREND')this.switchToTrend()},
  switchToTrend(){if(this.data.loading)return;replacePage('/pages/nutrient-trend/nutrient-trend?code='+encodeURIComponent(this.data.nutrientCode)+'&endDate='+this.data.dateLabel+'&dayReportId='+encodeURIComponent(this.data.reportId)+(this.data.periodId?'&periodId='+encodeURIComponent(this.data.periodId):''))},
  toggleConclusion() { if (this.data.expandableConclusion) this.setData({ conclusionExpanded: !this.data.conclusionExpanded }) },
  toggleAbout() { this.setData({ aboutExpanded: !this.data.aboutExpanded }) },
  goBack() { backPage('/pages/report/report',this) },
})
