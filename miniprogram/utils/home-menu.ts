import { slotNames } from './diet-plan'
import type { MenuLatest, MenuTask } from './diet-plan'

export interface HomeMenuPreview {
  sourceLabel?:string
  state: 'LOADING' | 'READY' | 'EMPTY' | 'RUNNING' | 'ERROR' | 'PROFILE'
  date: string
  dateLabel: string
  taskId: string
  meals: Array<{ slot: string; label: string; names: string; optional: boolean }>
  message: string
  link: string
  generating: boolean
}

const dayMs = 86400000, offset = 8 * 3600000
export function chinaMenuDates(now = Date.now()) {
  const shifted = new Date(now + offset)
  const start = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
  return { today: new Date(start).toISOString().slice(0, 10), tomorrow: new Date(start + dayMs).toISOString().slice(0, 10), refreshIn: start + dayMs - (now + offset) + 250 }
}

export function emptyHomeMenu(state: HomeMenuPreview['state'], message: string, link: string): HomeMenuPreview {
  return { state, message, link, date: '', dateLabel: '', taskId: '', meals: [], generating: false }
}

export function menuDayPreview(task: MenuTask | null, date: string): HomeMenuPreview['meals'] {
  const plan = task?.plan, day = plan?.days.find(d => d.date === date)
  if (!plan || !day) return []
  return day.meals.filter(m => Boolean(slotNames[m.slot])).map(m => {
    const names = m.recipeKeys.map(key => plan.recipes.find(r => r.key === key)?.name.trim()).filter(Boolean).join('、')
    return { slot: m.slot, label: m.slot === 'SNACK' ? '点心' : slotNames[m.slot], names, optional: m.slot === 'SNACK' }
  }).filter(m => Boolean(m.names))
}

export function homeMenuPreview(latest: MenuLatest, now = Date.now()): HomeMenuPreview {
  const source=latest.plan?.menuSource,sourceLabel=source?.kind==='SHARED'?'他人分享 · 非根据本宝宝饮食记录生成':latest.canManageMenu===false?'管理员菜单 · 仅可查看':''
  const origin=sourceLabel?{sourceLabel}:{}
  const dates = chinaMenuDates(now), generating = latest.task?.state === 'RUNNING'
  for (const [date, relative] of [[dates.today, '今日'], [dates.tomorrow, '明日']]) {
    const meals = menuDayPreview(latest.plan, date)
    if (meals.length) return { ...origin,state: 'READY', date, dateLabel: `${relative} · ${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`, taskId: latest.plan!.taskId, meals, message: '', link: '查看搭配', generating }
  }
  if((source?.kind==='SHARED'||latest.canManageMenu===false)&&latest.plan?.plan?.days.length){const date=latest.plan.plan.days[0].date,meals=menuDayPreview(latest.plan,date);if(meals.length)return {...origin,state:'READY',date,dateLabel:date.replace(/-/g,'/'),taskId:latest.plan.taskId,meals,message:'',link:'查看搭配',generating}}
  if(latest.canManageMenu===false)return {...origin,...emptyHomeMenu('EMPTY','管理员尚未生成菜单','查看菜单')}
  if (generating) return { ...emptyHomeMenu('RUNNING', '菜单正在生成，完成后可查看搭配', '查看菜单'), generating: true }
  const expired = latest.plan && latest.plan.endDate < dates.today
  return emptyHomeMenu('EMPTY', expired ? '现有菜单已结束，点击生成菜单' : '今天和明天暂无菜单，点击生成菜单', '生成菜单')
}

export function homeMenuDayIndex(task: MenuTask | null, date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !menuDayPreview(task, date).length) return -1
  return task!.plan!.days.findIndex(day => day.date === date)
}

export interface HomeMenuFeatured {recipeKey:string;name:string;slotLabel:string;texture:string;description:string;minutes:number|null}
// Select an existing menu slot by current China time; never generate or rewrite recipes.
export function homeMenuFeatured(latest:MenuLatest,preview:HomeMenuPreview,now=Date.now()):HomeMenuFeatured|null {
  const task=latest.plan,plan=task?.plan;
  if(preview.state!=='READY'||!plan||task?.taskId!==preview.taskId)return null;
  const day=plan.days.find(d=>d.date===preview.date);if(!day)return null;
  for(const meal of timeOrderedMenuMeals(preview.meals,preview.date,now)){
    const keys=day.meals.find(m=>m.slot===meal.slot)?.recipeKeys||[];
    const recipe=keys.map(key=>plan.recipes.find(r=>r.key===key)).find(r=>Boolean(r?.name.trim()));
    if(recipe)return {recipeKey:recipe.key,name:recipe.name,slotLabel:meal.label+(meal.optional?'（按需）':''),texture:({PUREE:'细泥',MASHED:'压碎',SOFT:'软小块'} as Record<string,string>)[recipe.texture]||'',description:recipe.description||'',minutes:Number.isFinite(recipe.preparationMinutes)&&recipe.preparationMinutes>0?recipe.preparationMinutes:null};
  }
  return null;
}

/** Today and tomorrow share the same current-time preview policy; historical menus retain their order. */
export function timeOrderedMenuMeals<T extends {slot:string}>(meals:T[],date:string,now=Date.now()):T[] {
  const dates=chinaMenuDates(now)
  if(date!==dates.today&&date!==dates.tomorrow)return meals
  const hour=new Date(now+offset).getUTCHours()
  const order=hour<10?['BREAKFAST','LUNCH','SNACK','DINNER']
    :hour<15?['LUNCH','SNACK','DINNER','BREAKFAST']
    :hour<17?['SNACK','DINNER','LUNCH','BREAKFAST']
    :hour<21?['DINNER','SNACK','LUNCH','BREAKFAST']:['SNACK','DINNER','LUNCH','BREAKFAST']
  const rank=(slot:string)=>{const n=order.indexOf(slot);return n<0?order.length:n}
  return meals.map((meal,index)=>({meal,index})).sort((a,b)=>rank(a.meal.slot)-rank(b.meal.slot)||a.index-b.index).map(v=>v.meal)
}

export function nextMenuSlotRefreshIn(now=Date.now()):number {
  const shifted=new Date(now+offset),start=Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),shifted.getUTCDate())
  const next=[10,15,17,21,24].find(hour=>hour>shifted.getUTCHours())!
  return start+next*3600000-(now+offset)+250
}
