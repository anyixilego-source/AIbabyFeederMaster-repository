import {familyState} from './family-state';
import {queueSharedMealPhoto,retrySharedMealPhotos} from './shared-meal-photo';
import { ApiError, getAuth, request } from './api';
import {prepareMealPhoto,linkMealPhoto} from './meal-photo';
import type {MealPhotoInput,LocalMealPhoto} from './meal-photo';
export interface PendingRecord {
    subjectId?:string;
    path: string;
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    kind: string;
    payload: Record<string, unknown>;
    localPhoto?: LocalMealPhoto;
}
function key(scope: string) { const auth = getAuth(); if (!auth?.clientSessionId)
    throw Error('请重新登录后再保存'); return 'foodmaster.pending-record.' + (auth.accountId||auth.clientSessionId) + ':' + scope; }
export function pendingRecord(scope: string): PendingRecord | undefined { return wx.getStorageSync(key(scope)) as PendingRecord | undefined; }
function finishPhoto(pending: PendingRecord, result: unknown): void {
    if (pending.kind !== 'CREATE_CONFIRMED_MEAL' || !pending.localPhoto || !result || typeof result !== 'object') return;
    const mealId = (result as {mealId?: unknown}).mealId;
    if (typeof mealId === 'string') { try { linkMealPhoto(mealId,pending.localPhoto);const subject=/^\/subjects\/([^/]+)\/meals/.exec(pending.path)?.[1];
      if(subject){queueSharedMealPhoto(mealId,subject,pending.localPhoto.filePath,pending.localPhoto.expiresAt);void retrySharedMealPhotos();} } catch { /* Photo cache failure must not turn a saved meal into a failed save. */ } }
}
export async function submitRecord<T>(scope: string, path: string, method: PendingRecord['method'], kind: string, body: Record<string, unknown>, photo?: MealPhotoInput): Promise<T> {
    const storageKey = key(scope), auth = getAuth();
    let pending = wx.getStorageSync(storageKey) as PendingRecord | undefined;
    if (pending) {
        if(pending.subjectId&&familyState()?.subjectId&&pending.subjectId!==familyState()?.subjectId)throw Error('请切回原宝宝后核对这次提交');
        try {
            const receipt = await request<{
                status: string;
                response: T | null;
            }>('/record-operations/' + pending.payload.operationId + '?kind=' + pending.kind);
            if (receipt.status === 'COMPLETED' && receipt.response) {
                finishPhoto(pending,receipt.response);
                wx.removeStorageSync(storageKey);
                wx.setStorageSync('foodmaster.recordEpoch', Number(wx.getStorageSync('foodmaster.recordEpoch') || 0) + 1);
                return receipt.response;
            }
        }
        catch (e) {
            if (e instanceof ApiError && [401, 403].includes(e.statusCode))
                throw e;
        }
    }
    else {
        pending = { subjectId:familyState()?.subjectId,path, method, kind, payload: { ...body, operationId: typeof body.operationId==='string'?body.operationId:'record-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14) } };
        if (kind === 'CREATE_CONFIRMED_MEAL' && photo) {
            try { pending.localPhoto = await prepareMealPhoto(photo); } catch { /* Saving a meal remains available when a local image cannot be retained. */ }
            if (getAuth()?.clientSessionId !== auth?.clientSessionId) throw Error('登录状态已变化');
        }
        wx.setStorageSync(storageKey, pending);
    }
    try {
        const result = await request<T>(pending.path, { method: pending.method, data: pending.payload });
        if (getAuth()?.clientSessionId !== auth?.clientSessionId)
            throw Error('登录状态已变化');
        finishPhoto(pending,result);
        wx.removeStorageSync(storageKey);
        return result;
    }
    catch (e) {
        if (e instanceof ApiError && (e.data as {code?:string}|null)?.code!=='FAMILY_CONTEXT_CHANGED' && e.statusCode >= 400 && e.statusCode < 500 && ![401, 403, 429].includes(e.statusCode))
            wx.removeStorageSync(storageKey);
        throw e;
    }
}
