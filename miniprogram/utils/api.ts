import { apiBaseUrl } from '../config'

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
      url: `${apiBaseUrl}${path}`,
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
    return await rawRequest<T>(path, options)
  } catch (caught) {
    const error = caught instanceof ApiError ? caught : new ApiError('网络请求失败', 0, caught)
    const auth = getAuth()
    if (!retried && error.statusCode === 401 && auth?.refreshToken && options.auth !== false) {
      try {
        const refreshed = await refreshSession(auth.refreshToken)
        setAuth(refreshed)
        return request<T>(path, options, true)
      } catch {
        clearAuth()
        error.authExpired = true
      }
    }
    throw error
  }
}
