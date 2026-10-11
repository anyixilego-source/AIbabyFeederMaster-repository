import { apiBaseUrl } from '../config'

export function reviewEnvironment(): { baseUrl: string; label: string; householdId?: string; subjectId?: string } | null {
  const env = wx.getStorageSync('foodmaster.reviewEnvironment') as { baseUrl?: string; label?: string; householdId?: string; subjectId?: string } | undefined
  if (wx.getSystemInfoSync().platform !== 'devtools' || !env || !/^http:\/\/127\.0\.0\.1:\d+\/api\/v1$/.test(env.baseUrl || '')) return null
  return { baseUrl: env.baseUrl!, label: env.label || '隔离验证 · 合成数据', householdId: env.householdId, subjectId: env.subjectId }
}
function runtimeBaseUrl(): string { return reviewEnvironment()?.baseUrl || apiBaseUrl }

const AUTH_KEY = 'foodmaster.auth'

export interface AuthSession {
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt?: string
  refreshTokenExpiresAt?: string
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  data?: unknown
  responseType?: 'text' | 'arraybuffer'
  auth?: boolean
  header?: Record<string, string>
}

export class ApiError extends Error {
  statusCode: number
  data: unknown
  authExpired = false

  constructor(message: string, statusCode: number, data: unknown) {
    super(message)
    this.statusCode = statusCode
    this.data = data
  }
}

let refreshPromise: Promise<AuthSession> | null = null
let refreshTokenInFlight: string | null = null

export function getAuth(): AuthSession | null {
  return (wx.getStorageSync(AUTH_KEY) as AuthSession | undefined) || null
}

export function setAuth(auth: AuthSession): void {
  wx.setStorageSync(AUTH_KEY, auth)
}

export function clearAuth(): void {
  wx.removeStorageSync(AUTH_KEY)
}

function responseMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object' || !('message' in data)) return fallback
  const message = (data as { message?: unknown }).message
  if (Array.isArray(message)) return message.map(String).join('；')
  return typeof message === 'string' ? message : fallback
}

function rawRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const auth = getAuth()
  const header: Record<string, string> = { 'content-type': 'application/json', ...(options.header || {}) }
  if (options.auth !== false && auth?.accessToken) header.Authorization = `Bearer ${auth.accessToken}`

  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: `${runtimeBaseUrl()}${path}`,
      responseType: options.responseType || 'text',
      method: (options.method || 'GET') as WechatMiniprogram.RequestOption['method'],
      data: options.data as WechatMiniprogram.IAnyObject | string | ArrayBuffer | undefined,
      header,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data as T)
          return
        }
        reject(new ApiError(responseMessage(response.data, `请求失败 ${response.statusCode}`), response.statusCode, response.data))
      },
      fail(error) {
        reject(new ApiError(error.errMsg || '网络请求失败', 0, error))
      },
    })
  })
}

function rawUpload<T>(path: string, filePath: string, formData: Record<string, string>): Promise<T> {
  const auth = getAuth()
  const header: Record<string, string> = {}
  if (auth?.accessToken) header.Authorization = `Bearer ${auth.accessToken}`
  return new Promise<T>((resolve, reject) => {
    wx.uploadFile({
      url: `${runtimeBaseUrl()}${path}`, filePath, name: 'image', formData, header,
      success(response) {
        let data: unknown = {}
        try { data = JSON.parse(response.data || '{}') as unknown } catch { data = {} }
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(data as T)
          return
        }
        reject(new ApiError(responseMessage(data, `上传失败 ${response.statusCode}`), response.statusCode, data))
      },
      fail(error) { reject(new ApiError(error.errMsg || '图片上传失败', 0, error)) },
    })
  })
}

function refreshSession(refreshToken: string): Promise<AuthSession> {
  if (refreshPromise && refreshTokenInFlight === refreshToken) return refreshPromise
  refreshTokenInFlight = refreshToken
  refreshPromise = rawRequest<AuthSession>('/identity/refresh', {
    method: 'POST', data: { refreshToken }, auth: false,
  }).finally(() => {
    if (refreshTokenInFlight === refreshToken) {
      refreshPromise = null
      refreshTokenInFlight = null
    }
  })
  return refreshPromise
}

export async function request<T>(path: string, options: RequestOptions = {}, retried = false): Promise<T> {
  try {
    const response = await rawRequest<T>(path, options)
    if (options.method && options.method !== 'GET' && (/^\/meals\//.test(path) || /^\/subjects\/[^/]+$/.test(path))) wx.setStorageSync('foodmaster.recordEpoch', Number(wx.getStorageSync('foodmaster.recordEpoch') || 0) + 1)
    return response
  } catch (caught) {
    const error = caught instanceof ApiError ? caught : new ApiError('网络请求失败', 0, caught)
    const auth = getAuth()
    if (!retried && error.statusCode === 401 && auth?.refreshToken && options.auth !== false) {
      // 刷新与业务重试分开：刷新成功但重试业务请求 500/网络失败时不得清登录；
      // 迟到的刷新结果只在会话仍是发起刷新的那个时才生效（第一批方案 §9）。
      let refreshed: AuthSession
      try {
        refreshed = await refreshSession(auth.refreshToken)
      } catch {
        clearAuth()
        error.authExpired = true
        throw error
      }
      const current = getAuth()
      if (!current || current.refreshToken !== auth.refreshToken) throw error
      setAuth(refreshed)
      return request<T>(path, options, true)
    }
    throw error
  }
}

export async function uploadRecognitionImage<T>(
  filePath: string,
  consent: { policyVersion: string; localRetention: string },
  retried = false,
): Promise<T> {
  try {
    return await rawUpload<T>('/recognition/candidates/image', filePath, {
      accepted: 'true', policyVersion: consent.policyVersion, localRetention: consent.localRetention,
    })
  } catch (caught) {
    const error = caught instanceof ApiError ? caught : new ApiError('图片上传失败', 0, caught)
    const auth = getAuth()
    if (!retried && error.statusCode === 401 && auth?.refreshToken) {
      try {
        const refreshed = await refreshSession(auth.refreshToken)
        setAuth(refreshed)
        return uploadRecognitionImage<T>(filePath, consent, true)
      } catch {
        clearAuth()
        error.authExpired = true
      }
    }
    throw error
  }
}

export async function uploadFeedbackImage<T>(filePath: string, operationId: string, retried = false): Promise<T> {
  try { return await rawUpload<T>('/feedback/images', filePath, { operationId }) }
  catch (caught) {
    const error = caught instanceof ApiError ? caught : new ApiError('图片上传失败', 0, caught)
    const auth = getAuth()
    if (!retried && error.statusCode === 401 && auth?.refreshToken) {
      let refreshed: AuthSession
      try { refreshed = await refreshSession(auth.refreshToken) } catch { clearAuth(); error.authExpired = true; throw error }
      setAuth(refreshed)
      return uploadFeedbackImage<T>(filePath, operationId, true)
    }
    throw error
  }
}

// Use only after the current account has received authorized collection metadata.
export function cachedPrivateCollectionImage(route: string): string {
 if(!getAuth() || !/^\/subjects\/[a-f0-9-]{36}\/diet-collections\/[a-f0-9]{64}\/images\/[a-f0-9-]{36}$/.test(route)) return ''
 const id=route.split('/').pop(),manager=wx.getFileSystemManager()
 for(const extension of ['png','jpg','webp']) {
  const file=wx.env.USER_DATA_PATH+'/foodmaster-recipe-'+id+'.'+extension
  try { manager.accessSync(file); return file } catch { /* An evicted local file is downloaded again. */ }
 }
 return ''
}

export async function downloadPrivateRecipeImage(route: string, retried = false): Promise<string> {
 if (!/^\/diet-plan-images\/[a-f0-9-]{36}$/.test(route) && !/^\/diet-plan-tasks\/[a-f0-9-]{36}\/recipes\/[a-zA-Z0-9_-]{1,64}\/images\/[a-f0-9-]{36}$/.test(route) && !/^\/subjects\/[a-f0-9-]{36}\/diet-collections\/[a-f0-9]{64}\/images\/[a-f0-9-]{36}$/.test(route)) throw new Error('示意图地址无效')
 const auth = getAuth(); if (!auth) throw new ApiError('请先登录', 401, null)
 const response = await new Promise<WechatMiniprogram.RequestSuccessCallbackResult<ArrayBuffer>>((resolve, reject) => wx.request<ArrayBuffer>({url: runtimeBaseUrl() + route,responseType:'arraybuffer',header: {Authorization:'Bearer ' + auth.accessToken},success: resolve,fail: reject}))
 if (response.statusCode === 401 && !retried && auth.refreshToken) { const refreshed = await refreshSession(auth.refreshToken); setAuth(refreshed); return downloadPrivateRecipeImage(route, true) }
 if (response.statusCode !== 200) throw new ApiError('示意图暂时无法读取',response.statusCode,null)
 if (!(response.data instanceof ArrayBuffer) || response.data.byteLength > 5*1024*1024) throw new Error('示意图内容无效')
 const bytes=new Uint8Array(response.data);const extension=bytes[0]===137&&bytes[1]===80?'png':bytes[0]===255&&bytes[1]===216?'jpg':bytes[0]===82&&bytes[1]===73&&bytes[8]===87&&bytes[9]===69?'webp':'';if(!extension)throw new Error('示意图格式无效')
 const filePath = wx.env.USER_DATA_PATH + '/foodmaster-recipe-' + route.split('/').pop() + '.' + extension
 await new Promise<void>((resolve, reject) => wx.getFileSystemManager().writeFile({filePath,data:response.data,success:()=>resolve(),fail:reject}))
 return filePath
}