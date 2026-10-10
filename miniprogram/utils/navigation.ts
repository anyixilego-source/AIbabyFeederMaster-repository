// Keep home below records/report/profile; complete detail journeys use at most five pages.
export const MAX_PAGE_DEPTH = 5
const HOME = '/pages/index/index'
const PRIMARY_ROUTES = new Set(['pages/records/records', 'pages/report-overview/report-overview', 'pages/profile/profile'])
interface Callbacks {
  success?: (res: WechatMiniprogram.GeneralCallbackResult) => void
  fail?: (res: WechatMiniprogram.GeneralCallbackResult) => void
}
interface NavigationState { navigating: boolean; sequence: number; pendingPrimary: string }
function navigationState() {
  const app = getApp<{ _navigation?: NavigationState }>()
  return app._navigation || (app._navigation = { navigating: false, sequence: 0, pendingPrimary: '' })
}
function target(url: string) {
  const [route, query = ''] = url.replace(/^\//, '').split('?'), options: Record<string, string> = {}
  for (const pair of query.split('&').filter(Boolean)) {
    const at = pair.indexOf('=')
    options[decodeURIComponent(at < 0 ? pair : pair.slice(0, at))] = decodeURIComponent(at < 0 ? '' : pair.slice(at + 1))
  }
  return { route, options }
}
function same(page: ReturnType<typeof getCurrentPages>[number] | undefined, url: string) {
  const d = target(url)
  if (!page || page.route !== d.route) return false
  if (d.route === 'pages/diet-menu/diet-menu') {
    const mode = d.options.settingsOnly === '1' ? 'SETTINGS' : d.options.recipe ? 'RECIPE' : d.options.date ? 'DAY' : 'WEEK'
    if (page.data.mode !== mode) return false
  }
  if (d.route === 'pages/diet-favorites/diet-favorites' && page.data.mode !== (d.options.recipe ? 'RECIPE' : 'LIST')) return false
  return Object.keys(d.options).every(key => {
    let value = page.options[key]
    if (key === 'endDate') value = page.data.endDate
    if (d.route === 'pages/records/records' && key === 'date') value = page.data.selectedDate || value
    if (d.route === 'pages/diet-menu/diet-menu' && key === 'date') value = page.data.currentDay?.date || value
    return String(value || '') === d.options[key]
  })
}
function rejected(callbacks: Callbacks, message: string) {
  if (callbacks.fail) callbacks.fail({ errMsg: message })
  else wx.showToast({ title: message, icon: 'none' })
}
function run(action: (c: { success: (r: WechatMiniprogram.GeneralCallbackResult) => void; fail: (r: WechatMiniprogram.GeneralCallbackResult) => void; complete: () => void }) => void, callbacks: Callbacks = {}) {
  const shared = navigationState()
  if (shared.navigating) { rejected(callbacks, '页面正在切换，请稍候'); return }
  shared.navigating = true
  const own = ++shared.sequence, release = () => { if (own === shared.sequence) shared.navigating = false }
  setTimeout(release, 2000)
  try {
    action({ success: r => { release(); callbacks.success?.(r) }, fail: r => { release(); rejected(callbacks, r.errMsg || '页面暂未打开，请重试') }, complete: release })
  } catch { release(); rejected(callbacks, '页面暂未打开，请重试') }
}
export function navigateRoot(url: string) {
  const shared = navigationState()
  if (shared.navigating) return
  shared.pendingPrimary = ''
  const pages = getCurrentPages()
  if (PRIMARY_ROUTES.has(target(url).route)) {
    run(c => {
      if (!same(pages[0], HOME)) {
        // A camera root or direct entry has no home parent. Establish it before opening the module.
        wx.reLaunch({ url: HOME, success: () => wx.navigateTo({ url, ...c }), fail: c.fail })
      } else if (pages.length === 1) wx.navigateTo({ url, ...c })
      else if (same(pages[1], url)) {
        if (pages.length > 2) wx.navigateBack({ delta: pages.length - 2, ...c })
        else { c.success({ errMsg: 'navigateTo:ok' }); c.complete() }
      } else if (pages.length === 2) wx.redirectTo({ url, ...c })
      else {
        // The departing page cannot reliably start a second route after it is unloaded.
        // Let the surviving primary page complete the replacement from its own onShow.
        shared.pendingPrimary = url
        wx.navigateBack({ delta: pages.length - 2, ...c, fail: r => { shared.pendingPrimary = ''; c.fail(r) } })
      }
    })
    return
  }
  if (same(pages[0], url)) {
    if (pages.length > 1) run(c => wx.navigateBack({ delta: pages.length - 1, ...c }))
  } else run(c => wx.reLaunch({ url, ...c }))
}
export function ensureHomeParent(owner: object) {
  const shared = navigationState()
  const pages = getCurrentPages(), page = pages[pages.length - 1]
  if (!page || page !== owner || !PRIMARY_ROUTES.has(page.route)) return false
  if (shared.pendingPrimary) {
    const url = shared.pendingPrimary
    const resume = () => {
      const current = getCurrentPages()
      if (current[current.length - 1] !== owner || shared.pendingPrimary !== url) return
      // onShow may precede the native back completion callback. Wait for that callback.
      if (shared.navigating) { setTimeout(resume, 16); return }
      navigateRoot(url)
    }
    setTimeout(resume, 300)
    return true
  }
  if (same(pages[0], HOME)) return false
  const query = Object.entries(page.options).filter(([, v]) => v !== undefined).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v))).join('&')
  const url = '/' + page.route + (query ? '?' + query : '')
  // Direct-launch onShow can run before the host finishes its initial route. Defer only this recovery.
  setTimeout(() => {
    const current = getCurrentPages()
    if (current[current.length - 1] === owner && !same(current[0], HOME)) navigateRoot(url)
  }, 120)
  return true
}
export function openPage(url: string, callbacks: Callbacks = {}) {
  const shared = navigationState()
  if (shared.navigating) { rejected(callbacks, '页面正在切换，请稍候'); return }
  const pages = getCurrentPages()
  for (let i = pages.length - 1; i >= 0; i--) if (same(pages[i], url)) {
    if (i === pages.length - 1) callbacks.success?.({ errMsg: 'navigateTo:ok' })
    else run(c => wx.navigateBack({ delta: pages.length - 1 - i, ...c }), callbacks)
    return
  }
  if (pages.length >= MAX_PAGE_DEPTH) { rejected(callbacks, '请返回上一级后再打开'); return }
  run(c => wx.navigateTo({ url, ...c }), callbacks)
}
export function replacePage(url: string) {
  const shared = navigationState()
  if (!shared.navigating) run(c => wx.redirectTo({ url, ...c }))
}
export function backTo(url: string, owner?: object) {
  const pages = getCurrentPages()
  if (owner && pages[pages.length - 1] !== owner) return
  for (let i = pages.length - 2; i >= 0; i--) if (same(pages[i], url)) {
    run(c => wx.navigateBack({ delta: pages.length - 1 - i, ...c })); return
  }
  replacePage(url)
}
export function backPage(fallback = HOME, owner?: object) {
  const pages = getCurrentPages()
  if (owner && pages[pages.length - 1] !== owner) return
  if (pages.length > 1) run(c => wx.navigateBack({ delta: 1, ...c }))
  else navigateRoot(fallback)
}
