import { ApiError, getAuth, request } from './api';
export interface PendingRecord {
    path: string;
    method: 'POST' | 'PATCH' | 'DELETE';
    kind: string;
    payload: Record<string, unknown>;
}
function key(scope: string) { const auth = getAuth(); if (!auth?.clientSessionId)
    throw Error('请重新登录后再保存'); return 'foodmaster.trial.pending-record.' + (auth.accountId||auth.clientSessionId) + ':' + scope; }
export function pendingRecord(scope: string): PendingRecord | undefined { return wx.getStorageSync(key(scope)) as PendingRecord | undefined; }
export async function submitRecord<T>(scope: string, path: string, method: PendingRecord['method'], kind: string, body: Record<string, unknown>): Promise<T> {
    const storageKey = key(scope), auth = getAuth();
    let pending = wx.getStorageSync(storageKey) as PendingRecord | undefined;
    if (pending) {
        try {
            const receipt = await request<{
                status: string;
                response: T | null;
            }>('/record-operations/' + pending.payload.operationId + '?kind=' + pending.kind);
            if (receipt.status === 'COMPLETED' && receipt.response) {
                wx.removeStorageSync(storageKey);
                wx.setStorageSync('foodmaster.trial.recordEpoch', Number(wx.getStorageSync('foodmaster.trial.recordEpoch') || 0) + 1);
                return receipt.response;
            }
        }
        catch (e) {
            if (e instanceof ApiError && [401, 403].includes(e.statusCode))
                throw e;
        }
    }
    else {
        pending = { path, method, kind, payload: { ...body, operationId: typeof body.operationId==='string'?body.operationId:'record-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14) } };
        wx.setStorageSync(storageKey, pending);
    }
    try {
        const result = await request<T>(pending.path, { method: pending.method, data: pending.payload });
        if (getAuth()?.clientSessionId !== auth?.clientSessionId)
            throw Error('登录状态已变化');
        wx.removeStorageSync(storageKey);
        return result;
    }
    catch (e) {
        if (e instanceof ApiError && e.statusCode >= 400 && e.statusCode < 500 && ![401, 403, 429].includes(e.statusCode))
            wx.removeStorageSync(storageKey);
        throw e;
    }
}
