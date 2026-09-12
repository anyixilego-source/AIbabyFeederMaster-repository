const OPERATION_KEY_PREFIX = 'foodmaster.operation.'

interface PendingOperation {
  fingerprint?: string
  operationId?: string
  payload?: Record<string, unknown>
}

function fingerprint(payload: Record<string, unknown>): string {
  return JSON.stringify(payload)
}

export function operationPayload(scope: string, payload: Record<string, unknown>): Record<string, unknown> {
  const storageKey = `${OPERATION_KEY_PREFIX}${scope}`
  const pending = wx.getStorageSync(storageKey) as PendingOperation | undefined
  const currentFingerprint = fingerprint(payload)
  if (pending?.fingerprint === currentFingerprint && pending.operationId && pending.payload) return pending.payload

  const operationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
  const request = { ...payload, operationId }
  wx.setStorageSync(storageKey, { fingerprint: currentFingerprint, operationId, payload: request })
  return request
}

export function getPendingOperation(scope: string): Record<string, unknown> | undefined {
  const pending = wx.getStorageSync(`${OPERATION_KEY_PREFIX}${scope}`) as PendingOperation | undefined
  return pending?.operationId && pending.payload ? pending.payload : undefined
}

export function completeOperation(scope: string, operationId: unknown): void {
  if (typeof operationId !== 'string') return
  const storageKey = `${OPERATION_KEY_PREFIX}${scope}`
  const pending = wx.getStorageSync(storageKey) as { operationId?: string } | undefined
  if (pending?.operationId === operationId) wx.removeStorageSync(storageKey)
}
