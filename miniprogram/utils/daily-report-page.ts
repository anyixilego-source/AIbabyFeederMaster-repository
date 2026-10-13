import { openPage, navigateRoot, backPage ,replacePage} from './navigation'
import { ApiError, request, reviewEnvironment } from './api'
import { loadReportBundle, nutrientNames } from './nutrition-report'
import type { NutrientView, AssessmentReport } from './nutrition-report'
interface MealSummary { status:string;occurredAt:string }
import { ensureSessionContext } from './session'
import { knowledgePanel, advanceKnowledgePanel } from './knowledge-panel'
import { limitationReason, explanationSentence } from './limitation-reasons'
import {dailyCards} from './nutrient-summary-card'

export function registerReportPage() {
Page({
  data: { loading:true,errorMessage:'',hasResult:false,hasRecords:false,showAll:false,showObservations:false,showKnowledge:false,showVersion:false,showLimitations:false,showLimitationReasons:false,showKnowledgeSources:false,showActions:false,observationCount:0,knowledgeCount:0,actionCount:0,
    reviewLabel:reviewEnvironment()?.label || '',selectedDate:'',fromRecords:false,fromPeriod:false,category:'ALL',categories:[{key:'ALL',name:'全部'},{key:'MACRO',name:'能量与宏量'},{key:'MINERAL',name:'矿物质'},{key:'VITAMIN',name:'维生素'}],subjectId:'',babyName:'宝宝',ageText:'',dateLabel:'',mealCount:0,foodCount:0,totalConsumedText:'',weightLabel:'记录重量',
    allNutrients:[] as NutrientView[],nutrients:[] as NutrientView[],observations:[] as NonNullable<AssessmentReport['result']['observations']>,
    visibleObservations:[] as NonNullable<AssessmentReport['result']['observations']>,allActions:[] as NonNullable<AssessmentReport['result']['actions']>,actions:[] as NonNullable<AssessmentReport['result']['actions']>,
    knowledge:[] as NonNullable<AssessmentReport['result']['knowledge']>['claims'],visibleKnowledge:[] as NonNullable<AssessmentReport['result']['knowledge']>['claims'],
    knowledgeScope:'',limitations:[] as Array<NonNullable<AssessmentReport['result']['limitations']>[number]&{reasonText:string}>,limitCount:0,
    observationCards:[] as ReturnType<typeof dailyCards>,periodId:'',currentRecordSummary:'',selectedReportId:'',reportId:'',generatedAt:'',evaluationVersion:'',knowledgeVersion:'',supersedesReportId:'',snapshotAvailable:false,legacyReport:false,milkLine:'',milkCount:0 },
  _loadSequence:0,_scroll:0,_loaded:false,_epoch:0,
  onPageScroll(e:{scrollTop:number}){this._scroll=e.scrollTop},
  onLoad(query:Record<string,string>){this._loaded=false;this.setData({periodId:query.periodId||'',selectedReportId:decodeURIComponent(query.reportId || ''),selectedDate:query.date || '',fromRecords:query.fromRecords==='1',fromPeriod:query.fromPeriod==='1'})},
  onShow() { const app=getApp<IAppOption>();void (app.globalData.ready || ensureSessionContext()).then(async ctx=>{if(this._loaded&&ctx.subjectId===this.data.subjectId){const eligible=Boolean(this.data.selectedReportId);if(eligible){await request('/subjects/'+ctx.subjectId);wx.pageScrollTo({scrollTop:this._scroll,duration:0});this.setData({loading:false});return}}if(this.data.subjectId&&ctx.subjectId!==this.data.subjectId)this.clearResult();void this.loadReport()}).catch(()=>{this.clearResult();this.setData({loading:false,errorMessage:'会话暂不可用，请重试'})}) },
  onHide() { ++this._loadSequence },
  async loadReport() {
    const sequence=++this._loadSequence
    this.setData({loading:true,errorMessage:''})
    try {
      const app=getApp<IAppOption>();const active=await(app.globalData.ready || ensureSessionContext())
      if(sequence!==this._loadSequence)return
      if(!active.subjectId){this.clearResult();throw new Error('请先建立宝宝档案')}
      if(this.data.subjectId && this.data.subjectId!==active.subjectId)this.clearResult()
      this.setData({subjectId:active.subjectId})
      const bundle=await loadReportBundle(active.subjectId,true,this.data.selectedReportId,this.data.selectedDate)
      if(sequence!==this._loadSequence)return
      const result=bundle.report.result,observations=(result.observations || []).map(o=>({...o,text:(nutrientNames[o.nutrientCode] || '营养素')+'：'+o.text})),knowledge=result.knowledge?.claims || []
      const milk = (result as { milk?: { summary: { feedCount: number; knownVolumeMl: string | null; unknownVolumeEventCount: number; estimatedVolumeRecordCount: number } } }).milk
      const milkSummary = milk?.summary
      const milkLine = milkSummary && milkSummary.feedCount > 0
        ? (milkSummary.knownVolumeMl !== null ? String(milkSummary.knownVolumeMl)+'毫升' : '—')
        : ''
      const milkCount = milkSummary?.feedCount ?? 0
      const legacyReport = !bundle.snapshotAvailable
      const failedMessage = bundle.updateState === 'FAILED' ? '记录已保存，报告暂未更新；正在展示上次结果，尚未包含最新修改。' : ''
      const compatibilityMessage = legacyReport ? this.data.selectedReportId
        ? '这份历史报告未保存新版记录统计与解读，按原有内容展示。'
        : '当前服务返回旧版报告，尚未支持新版记录统计与解读。已保存餐食不受影响，可在记录页查看。' : ''
      this.setData({currentRecordSummary:'',errorMessage:[failedMessage,compatibilityMessage].filter(Boolean).join(''),legacyReport,hasResult:true,hasRecords:bundle.mealCount>0,babyName:bundle.subject.displayName,ageText:bundle.ageText,dateLabel:bundle.dateLabel,
        mealCount:bundle.mealCount,foodCount:bundle.foodCount,totalConsumedText:bundle.totalConsumedText.replace(/^约/,''),weightLabel:'食物重量',
        allNutrients:bundle.nutrients,nutrients:this.data.category==='ALL'?bundle.nutrients:bundle.nutrients.filter(n=>n.category===this.data.category),observations:observations,observationCount:observations.length,visibleObservations:this.data.showObservations?observations:observations.slice(0,3),observationCards:dailyCards(this.data.showObservations?observations:observations.slice(0,3),bundle.nutrients),
        allActions:result.actions || [],actions:this.data.showActions?(result.actions || []):(result.actions || []).slice(0,2),actionCount:(result.actions || []).length,knowledge:knowledge,knowledgeCount:knowledge.length,...knowledgePanel(knowledge,this.data.showKnowledge,this.data.showKnowledgeSources),knowledgeScope:result.knowledge?.scopeDeclaration || '',
        limitations:(result.limitations || []).map(l=>({...l,text:(nutrientNames[l.nutrientCode] || '营养素')+'：'+explanationSentence(l.text),reasonText:limitationReason(l.reasonCodes)})),limitCount:new Set((result.limitations || []).map(l=>l.nutrientCode)).size,
        reportId:bundle.report.reportId,generatedAt:new Date(bundle.report.generatedAt).toLocaleString('zh-CN'),evaluationVersion:result.assessment.assessmentAlgorithmVersion || '历史版本',
        knowledgeVersion:result.knowledge?.version || '历史知识未保存',supersedesReportId:bundle.report.supersedesReportId || '',snapshotAvailable:bundle.snapshotAvailable,milkLine:milkLine,milkCount:milkCount})
      this._loaded=true;this._epoch=Number(wx.getStorageSync('foodmaster.recordEpoch') || 0)
      if(bundle.updateState==='FAILED'&&!this.data.selectedReportId)void this.loadCurrentRecords(sequence,bundle.date)
      if(bundle.updateState==='CURRENT')wx.removeStorageSync('foodmaster.reportNeedsRefresh')
    } catch(error) {
      if(sequence!==this._loadSequence)return
      if(error instanceof ApiError && ([401,403].includes(error.statusCode) || /access denied/i.test(error.message)))this.clearResult()
      if(this.data.hasResult&&!this.data.selectedReportId)void this.loadCurrentRecords(sequence,this.data.selectedDate || new Date().toLocaleDateString('sv-SE'))
      this.setData({errorMessage:error instanceof Error && ['请先建立宝宝档案','请先切换到该报告所属宝宝'].includes(error.message)?error.message:this.data.hasResult?'报告暂未更新；正在展示上次结果，尚未包含最新修改。可稍后重试或继续记录。':'首次报告尚无结果。可稍后重试或查看已保存记录。'})
    } finally { if(sequence===this._loadSequence)this.setData({loading:false}) }
  },
  async loadCurrentRecords(sequence:number,date:string){try{const meals=await request<MealSummary[]>('/subjects/'+this.data.subjectId+'/meals');if(sequence!==this._loadSequence)return;const current=meals.filter(m=>m.status==='CONFIRMED'&&new Date(m.occurredAt).toLocaleDateString('sv-SE')===date);this.setData({currentRecordSummary:current.length+'餐已保存。以下报告仍为上次修订；本餐明细可在记录页核看。'})}catch{}},
  clearResult(){this._loaded=false;this.setData({hasResult:false,hasRecords:false,showLimitations:false,showLimitationReasons:false,showAll:false,showObservations:false,category:'ALL',subjectId:'',babyName:'宝宝',ageText:'',dateLabel:'',reportId:'',mealCount:0,foodCount:0,totalConsumedText:'',weightLabel:'',generatedAt:'',evaluationVersion:'',knowledgeVersion:'',knowledgeScope:'',supersedesReportId:'',snapshotAvailable:false,legacyReport:false,allNutrients:[],nutrients:[],observations:[],visibleObservations:[],allActions:[],actions:[],knowledge:[],visibleKnowledge:[],showKnowledge:false,showKnowledgeSources:false,limitations:[],observationCount:0,knowledgeCount:0,actionCount:0,limitCount:0})},
  selectCategory(e:WechatMiniprogram.TouchEvent){const key=String(e.currentTarget.dataset.key);this.setData({category:key,nutrients:key==='ALL'?this.data.allNutrients:this.data.allNutrients.filter(n=>n.category===key)})},
  openOverview(){navigateRoot('/pages/report-overview/report-overview?endDate='+this.data.dateLabel.slice(0,10))},
  toggleActions(){const expanded=!this.data.showActions;this.setData({showActions:expanded,actions:expanded?this.data.allActions:this.data.allActions.slice(0,2)})},
  scrollToObservations(){wx.createSelectorQuery().selectViewport().scrollOffset().select('#observations-card').boundingClientRect().exec(result=>{if(result[0]&&result[1]){const top=Math.max(0,result[0].scrollTop+result[1].top-(wx.getSystemInfoSync().statusBarHeight || 0)-52);this._scroll=top;wx.pageScrollTo({scrollTop:top,duration:0})}})},
  openAllNutrients(){this.setData({showAll:true,category:'ALL',nutrients:this.data.allNutrients},()=>this.scrollToObservations())},
  returnToObservations(){this.setData({showAll:false,showObservations:false,visibleObservations:this.data.observations.slice(0,3),observationCards:dailyCards(this.data.observations.slice(0,3),this.data.allNutrients),category:'ALL',nutrients:this.data.allNutrients},()=>this.scrollToObservations())},
  toggleAll(){if(this.data.showAll)this.returnToObservations();else this.openAllNutrients()},
  toggleObservations(){const expanded=!this.data.showObservations;this.setData({showObservations:expanded,visibleObservations:expanded?this.data.observations:this.data.observations.slice(0,3),observationCards:dailyCards(expanded?this.data.observations:this.data.observations.slice(0,3),this.data.allNutrients)})},
  toggleKnowledge(){this.setData(advanceKnowledgePanel(this.data.knowledge,this.data.showKnowledge,this.data.showKnowledgeSources))},
  
  toggleVersion(){this.setData({showVersion:!this.data.showVersion})},toggleLimitations(){this.setData({showLimitations:!this.data.showLimitations,showLimitationReasons:false})},advanceLimitations(){if(!this.data.showLimitations)this.setData({showLimitations:true,showLimitationReasons:false});else this.setData({showLimitationReasons:!this.data.showLimitationReasons})},
  openNutrient(event:WechatMiniprogram.TouchEvent){openPage('/pages/nutrient-detail/nutrient-detail?code='+encodeURIComponent(String(event.currentTarget.dataset.code))+'&reportId='+encodeURIComponent(this.data.reportId)+(this.data.periodId?'&periodId='+encodeURIComponent(this.data.periodId):''))},
  startMeal(){navigateRoot('/pages/camera/camera')},
  viewRecords(){navigateRoot('/pages/records/records?date='+this.data.dateLabel.slice(0,10))},
  openPrevious(){if(this.data.supersedesReportId){const url='/pages/report-history/report-history?reportId='+encodeURIComponent(this.data.supersedesReportId);if(this.data.selectedReportId)replacePage(url);else openPage(url)}},
  goBack(){backPage(this.data.fromRecords?'/pages/records/records?date='+encodeURIComponent(this.data.selectedDate):this.data.fromPeriod?'/pages/report-overview/report-overview':'/pages/index/index',this)},refreshReport(){if(!this.data.loading)void this.loadReport()}
})
}
