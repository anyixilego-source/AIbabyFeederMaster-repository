import type { PeriodNutrient } from './nutrition-period'
import { chartNumber } from './trend-chart'
export function trendDate(date:string):string {
 const m=/^\d{4}-(\d{2})-(\d{2})$/.exec(date)
 return m ? Number(m[1])+'月'+Number(m[2])+'日' : date
}
/** Presentation only: use the exact saved day selected by the existing navigation context. */
export function trendPresentation(n:PeriodNutrient,dayReportId:string,startDate:string,endDate:string,selectedDate='') {
 const day=selectedDate ? n.entries.find(e=>e.date===selectedDate) : dayReportId ? n.entries.find(e=>e.reportId===dayReportId) : undefined
 return { rangeLabel:[trendDate(startDate),trendDate(endDate)].filter(Boolean).join(' — '),
  hasReference:!!n.reference,selectedDate:day?.date||selectedDate,
  dayPreview:day ? {date:trendDate(day.date),valueText:day.value===null?'—':chartNumber(Number(day.value)),hasValue:day.value!==null,partial:day.partial} : null,
  comparisonSummary:n.comparableDays>0 ? n.comparableDays+'个可比较日中，'+n.nonLowDays+'日记录量未低于参考值' : n.description }
}
