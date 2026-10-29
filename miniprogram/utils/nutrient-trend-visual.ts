import {aiSourceView} from './ai-source'
import type { PeriodNutrient } from './nutrition-period'
import { chartNumber } from './trend-chart'
import {unitNames} from './nutrition-report'
export function trendDate(date:string):string {
 const m=/^\d{4}-(\d{2})-(\d{2})$/.exec(date)
 return m ? Number(m[1])+'月'+Number(m[2])+'日' : date
}
/** Presentation only: use the exact saved day selected by the existing navigation context. */
export function trendPresentation(n:PeriodNutrient,dayReportId:string,startDate:string,endDate:string,selectedDate='') {
 const fat=n.specialReference?.version==='recorded-special-reference-v1'&&n.specialReference.kind==='FAT_ENERGY_SHARE'
 const day=selectedDate ? n.entries.find(e=>e.date===selectedDate) : dayReportId ? n.entries.find(e=>e.reportId===dayReportId) : undefined
 const value=fat?day?.specialReference?.ratioPercent??null:day?.value??null
 return { rangeLabel:[trendDate(startDate),trendDate(endDate)].filter(Boolean).join(' — '),
  hasReference:n.specialReference?!n.specialReference.crossReference&&n.specialReference.indicators.length>0:!!n.reference,selectedDate:day?.date||selectedDate,
  dayPreview:day ? {...aiSourceView(day.sourceBreakdown,unitNames?.[day.unit]||day.unit),date:trendDate(day.date),valueText:value===null?'—':chartNumber(Number(value)),hasValue:value!==null,unitText:fat?'%':unitNames?.[day.unit]||day.unit,partial:fat?false:day.partial,sourceAmountText:fat?'已记录脂肪'+(day.specialReference?.fatGrams==null?'—':chartNumber(Number(day.specialReference.fatGrams)))+'克；能量'+(day.specialReference?.energyKcal==null?'资料暂缺':chartNumber(Number(day.specialReference.energyKcal))+'千卡'):''} : null,
  comparisonSummary:n.comparableDays>0 ? n.comparableDays+'个可比较日中，'+n.nonLowDays+'日记录量未低于参考值' : n.description }
}
