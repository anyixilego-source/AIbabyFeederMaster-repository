import { AuthSession, getAuth, request, setAuth } from './api'

export interface HouseholdSummary {
  householdId: string
  name?: string
  role?: string
}

export interface SubjectSummary {
  subjectId: string
  displayName: string
  birthDate: string
  sex: 'FEMALE' | 'MALE' | 'UNSPECIFIED'
}

export interface SessionContext {
  householdId: string | null
  subjectId: string | null
  households: HouseholdSummary[]
  subjects: SubjectSummary[]
}

function wechatCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: ({ code }) => code ? resolve(code) : reject(new Error('微信登录未返回 code')),
      fail: reject,
    })
  })
}

async function login(): Promise<void> {
  const code = await wechatCode()
  const auth = await request<AuthSession>('/identity/wechat/login', {
    method: 'POST', auth: false,
    data: { code, displayName: '微信用户', deviceLabel: '微信小程序' },
  })
  setAuth(auth)
}

async function loadSessionContext(): Promise<SessionContext> {
  if (!getAuth()) await login()
  let households: HouseholdSummary[]
  try {
    households = await request<HouseholdSummary[]>('/households')
  } catch (error) {
    if (getAuth()) throw error
    await login()
    households = await request<HouseholdSummary[]>('/households')
  }
  const householdId = households[0]?.householdId ?? null
  const subjects = householdId
    ? await request<SubjectSummary[]>(`/households/${householdId}/subjects`)
    : []
  return { householdId, subjectId: subjects[0]?.subjectId ?? null, households, subjects }
}

export async function ensureSessionContext(): Promise<SessionContext> {
  return loadSessionContext()
}

export function refreshSessionContext(): Promise<SessionContext> {
  const app = getApp<IAppOption>()
  const ready = loadSessionContext().then((value) => {
    app.globalData.householdId = value.householdId || undefined
    app.globalData.subjectId = value.subjectId || undefined
    return value
  }).catch((error: unknown) => {
    if (app.globalData.ready === ready) app.globalData.ready = undefined
    throw error
  })
  app.globalData.ready = ready
  return ready
}
