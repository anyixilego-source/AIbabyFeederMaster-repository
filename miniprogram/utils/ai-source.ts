import {displayInteger} from './quantity-format'
export interface AiSourceBreakdown {regularAmount:string|null;aiAmount:string|null;displayTotal:string|null;hasAiValue:boolean;hasAiRecord:boolean;aiShare:string|null;partial:boolean;comparisonPolicy:string}
export const aiNumber=(value:string)=>Number(value)>0&&Number(value)<1?'<1':displayInteger(value)
export function aiSourceView(source:AiSourceBreakdown|undefined|null,unit=''){
 const has=!!source&&source.hasAiValue&&source.aiAmount!==null,share=has&&source.aiShare!==null?Math.round(Number(source.aiShare)*100):null
 return {hasAiValue:has,aiAmountText:has?aiNumber(source.aiAmount!)+unit:'',aiShareText:share===null?'':share+'%',regularAmountText:source?.regularAmount==null?'':aiNumber(source.regularAmount)+unit}
}
