// Explain only saved reason codes. Never recalculate or infer a nutrient result.
const reasons:Record<string,string>={
 PARTIAL_NUTRIENT_DATA:'部分食物缺少本项营养数据，当前只能汇总已知部分。',
 NO_CALCULABLE_VALUE:'已保存食品缺少本项可计算数值，不能把缺失当作零。',
 REFERENCE_COMPARISON_SUSPENDED:'本项参考口径仍待核验，暂不进行高低比较。',
 REFERENCE_COMPARISON_SUSPENDED_PENDING_SOURCE_AUDIT:'本项参考口径仍待核验，暂不进行高低比较。',
 REFERENCE_INFORMATION_ONLY:'本项参考指标仅作信息展示，不用于当前低值记录判定。',
 NO_APPLICABLE_RULE:'这份报告未匹配到适用的本项参考规则。',
 OUTSIDE_APPROVED_AGE_OR_POPULATION:'这份报告的月龄或适用条件超出当前已批准规则范围。',
 KNOWN_SPECIAL_RESTRICTIONS:'已记录的特殊限制不适用本版一般参考规则。',
 AMBIGUOUS_INDICATOR_RULE:'存在多条可能适用的参考规则，核对前不选择其中一条比较。',
 UNIT_BASIS_OR_SOURCE_UNVERIFIED:'数值单位、计算基准或来源口径尚未核验，不能保证与参考值直接对照。',
 REFERENCE_UNIT_MISMATCH:'记录数值和参考值的单位口径不一致，暂不能直接比较。',
 RELATION_UNCERTAIN_DUE_TO_MISSING_DATA:'缺失部分可能影响与参考值的关系，不能据已知量判断全部记录。',
 NO_CONFIRMED_INTAKE:'没有已保存并确认的摄入记录，不能生成记录量对照。',
 NO_CONFIRMED_RECORDS:'没有已保存并确认的摄入记录，不能生成记录量对照。',
 CROSS_RULE_VERSION:'窗口涉及不同参考版本，不能把它们合并成统一比较。'
}
export function limitationReason(codes?:string[]):string {
 if(!codes?.length)return '这份报告未保存进一步的原因依据。'
 const messages=[...new Set(codes.map(code=>reasons[code]).filter(Boolean))]
 return messages.length?messages.join(''):'这份报告的具体原因尚无对应说明，请以保存的原文为准。'
}

// Display punctuation only; saved report statements remain unchanged.
export function explanationSentence(text:string):string {
 const value=text.trim()
 return !value || /[。！？.!?]$/.test(value) ? value : value.replace(/[，,；;：:]+$/, '')+'。'
}
// Only saved recorded-day reasons are used. Unrecorded dates do not mean
// that the entire seven-day window has no confirmed records.
export function periodLimitationReason(n:{entries?:Array<{recorded:boolean;qualified:boolean;reasons?:string[]}>;crossVersion?:boolean}):string {
 const entries=n.entries || []
 const codes=entries.filter(e=>e.recorded&&!e.qualified).flatMap(e=>e.reasons || [])
 if(n.crossVersion)codes.push('CROSS_RULE_VERSION')
 const missing=entries.some(e=>!e.recorded)?'未记录日期不纳入可比较日。':''
 return missing+limitationReason(codes)
}
