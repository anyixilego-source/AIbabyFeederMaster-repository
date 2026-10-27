import type {NutrientView} from './nutrition-report'
// Presentation only: reuse the report's comparison eligibility and percentage label.
export function detailComparison(n:NutrientView){
 const suspended=['CARBOHYDRATE','VITAMIN_A_RAE','FOLATE','IODINE'].includes(n.nutrientCode)&&!n.referenceSourceApproved,label=n.progressLabel.match(/([0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?)%$/i);
 const available=!suspended&&n.showProgress&&n.outputEligibility==='FULL_COMPARISON'&&n.referenceType==='RNI'&&Number(n.recommendedValue)>0&&n.numericValue!==null&&Number.isFinite(n.numericValue)&&n.numericValue>=0&&Number.isFinite(n.progressPercent)&&n.progressPercent>=0&&label!==null;
 const color=!available?'neutral':n.status==='ABOVE_UPPER_LIMIT'?'red':n.progressPercent<30?'red':n.progressPercent<70?'yellow':'green';
 const stroke=({neutral:'#d4c9bc',red:'#e67b78',yellow:'#efbc65',green:'#a8c980'} as Record<string,string>)[color];
 return {comparisonAvailable:available,comparisonPercent:available?Math.min(100,n.progressPercent):0,comparisonText:available?label![1]:'—',comparisonColor:color,comparisonStroke:stroke,comparisonCaption:available?'记录量对照':n.numericValue===null?'暂无可计算值':n.rangeLowerValue!==null&&n.rangeUpperValue!==null?'参考区间':'仅展示记录量'};
}
