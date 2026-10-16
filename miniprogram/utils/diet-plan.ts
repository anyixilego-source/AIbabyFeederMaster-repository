import type {AiDiagnostic} from './ai-failure'
export interface MenuSettings { avoidance:'NONE'|'KNOWN';avoidIngredients:string[];texture:'PUREE'|'MASHED'|'SOFT';medicalDiet:boolean }
export interface MenuPreference extends MenuSettings {medicalDiet:false;consentVersion:string}
export interface MenuSettingsResponse {preference:MenuSettings|null;preferenceVersion:number}
export interface MenuRecipe {key:string;name:string;description?:string;servings:1;preparationMinutes:number;texture:string;ingredients:{name:string;state:string;quantity:string;unit:string}[];steps:string[];textureAdvice:string;replacement:string}
export interface MenuDay {date:string;meals:{slot:string;recipeKeys:string[]}[]}
export interface MenuTask {taskId:string;state:string;plan:{rationale?:string;recipes:MenuRecipe[];days:MenuDay[]}|null;failureMessage:string|null;diagnostic?:AiDiagnostic|null;startDate:string;endDate:string;generatedAt:string;focus:{nutrientCode:string;comparableDays:number;lowDays:number}[];recordedDays:number;risk:string}
export interface MenuLatest {plan:MenuTask|null;task:MenuTask|null;preference:MenuSettings|null;preferenceVersion:number;quota:{firstRemaining:number;regenerationsRemaining:number;textCalls:number;imageRemaining:number};imageCapability:string;risk:string}
export const menuRisk='AI生成，仅供参考。备餐用量为估算，请结合宝宝实际情况、食材适用性及咀嚼吞咽能力调整，不替代专业建议。'
export const slotNames:Record<string,string>={BREAKFAST:'早餐',LUNCH:'午餐',DINNER:'晚餐',SNACK:'点心（按需）'}
export function operationId(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.floor(Math.random()*16);return(c==='x'?r:(r&3)|8).toString(16)})}
export function dayRows(task:MenuTask){const plan=task.plan;if(!plan)return [];return plan.days.map(day=>{const meals=day.meals.map(meal=>({slot:meal.slot,label:slotNames[meal.slot],recipes:meal.recipeKeys.map(key=>plan.recipes.find(r=>r.key===key)!).filter(Boolean)}));return {date:day.date,label:day.date.slice(5),meals,firstLine:meals.slice(0,2).map(m=>m.label+'：'+m.recipes.map(r=>r.name).join('、')).join('  ·  '),secondLine:meals.slice(2).map(m=>m.label+'：'+m.recipes.map(r=>r.name).join('、')).join('  ·  ')}})}

export function menuRationale(task:MenuTask|null):string {return task?.plan?.rationale||'结合已确认条件安排多样食材与餐次搭配，并按宝宝能接受的形态调整，作为日常备餐参考。'}
