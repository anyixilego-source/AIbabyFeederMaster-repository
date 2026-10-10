import { slotNames } from './diet-plan'
import type { MenuLatest, MenuTask } from './diet-plan'

export interface HomeMenuPreview {
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
  const dates = chinaMenuDates(now), generating = latest.task?.state === 'RUNNING'
  for (const [date, relative] of [[dates.today, '今日'], [dates.tomorrow, '明日']]) {
    const meals = menuDayPreview(latest.plan, date)
    if (meals.length) return { state: 'READY', date, dateLabel: `${relative} · ${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`, taskId: latest.plan!.taskId, meals, message: '', link: '查看搭配', generating }
  }
  if (generating) return { ...emptyHomeMenu('RUNNING', '菜单正在生成，完成后可查看搭配', '查看菜单'), generating: true }
  const expired = latest.plan && latest.plan.endDate < dates.today
  return emptyHomeMenu('EMPTY', expired ? '现有菜单已结束，可规划接下来7天的搭配' : '为宝宝规划接下来7天的搭配', '规划菜单')
}

export function homeMenuDayIndex(task: MenuTask | null, date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !menuDayPreview(task, date).length) return -1
  return task!.plan!.days.findIndex(day => day.date === date)
}
