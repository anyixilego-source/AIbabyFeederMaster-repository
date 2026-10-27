import {displayInteger} from './quantity-format'
export interface SpecialReferenceData {
 version:string;kind:'FAT_ENERGY_SHARE'|'SODIUM_INFORMATION';ratioPercent?:string|null;fatGrams?:string|null;energyKcal?:string|null;
 reasonCodes?:string[];ratioDays?:number;crossReference?:boolean;
 indicators:Array<{direction:string;rule:{ruleId:string;referenceType:string;recommendedValue:string|null;rangeLowerValue?:string|null;rangeUpperValue?:string|null;unitCode:string;source:string;sourceVersion:string}}>
}
export function specialReferenceView(s:SpecialReferenceData|null|undefined){
 if(!s||s.version!=='recorded-special-reference-v1')return null
 const ratio=s.ratioPercent==null?null:Number(s.ratioPercent),available=ratio!==null&&Number.isFinite(ratio)&&ratio>=0&&ratio<=100
 const rows=s.indicators.map(i=>({label:i.rule.referenceType==='PI_NCD'?'控制方向参考（PI-NCD）':i.rule.referenceType==='AMDR'?'供能比例参考区间（AMDR）':s.kind==='FAT_ENERGY_SHARE'?'适宜供能参考（AI）':'适宜摄入参考（AI）',
   valueText:i.rule.referenceType==='AMDR'?displayInteger(i.rule.rangeLowerValue)+'%～'+displayInteger(i.rule.rangeUpperValue)+'%':(i.rule.referenceType==='PI_NCD'?'≤':'')+displayInteger(i.rule.recommendedValue)+(i.rule.unitCode==='PERCENT'?'%':' 毫克/日'),type:i.rule.referenceType}))
 const ref=s.indicators[0]?.rule,hasRange=ref?.referenceType==='AMDR',lower=Number(ref?.rangeLowerValue||0),upper=Number(ref?.rangeUpperValue||ref?.recommendedValue||0),max=Math.max(60,Math.ceil(Math.max(available?ratio!:0,upper)/10)*10+10)
 const reasons=s.reasonCodes||[],reasonText=reasons.includes('FAT_ENERGY_EXCEEDS_RECORDED_ENERGY')?'脂肪与能量资料口径需核对，供能比暂不计算。':reasons.includes('RECORDED_ENERGY_NOT_POSITIVE')?'当前能量不可作为分母，供能比暂不计算。':'脂肪或能量资料暂缺，供能比暂不计算；脂肪克数照常展示。'
 return {kind:s.kind,available,ratioText:available?displayInteger(ratio):'—',markerPercent:available?ratio!/max*100:0,scaleMaxText:displayInteger(max),hasRange,rangeStartPercent:lower/max*100,rangeWidthPercent:(upper-lower)/max*100,pointPercent:upper/max*100,rows,
  summaryText:s.ratioDays===undefined?'':s.ratioDays+'日有可计算的记录供能比',reasonText,
  sourceText:[...new Set(s.indicators.map(i=>i.rule.source+' · '+i.rule.sourceVersion))].join('；'),
  scopeText:s.kind==='FAT_ENERGY_SHARE'?'仅表示这些记录的供能比例，不代表全天膳食结构。':'AI与控制参考分开理解，低于AI不提示增加盐。'}
}
export type SpecialReferenceView=ReturnType<typeof specialReferenceView>
