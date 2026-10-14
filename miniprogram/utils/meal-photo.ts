import {getAuth} from './api'
import {saveLocalImage,retainedImageExpiry} from './image-retention'
import type {RetentionChoice} from './image-retention'

export interface MealPhotoInput { filePath: string; retention: RetentionChoice }
export interface LocalMealPhoto { accountId: string; filePath: string; expiresAt: number }
interface PhotoAssociation extends LocalMealPhoto { mealId: string }
function storageKey(accountId: string) { return 'foodmaster.meal-photos.' + accountId }
function associations(accountId: string): PhotoAssociation[] {
  const value: unknown = wx.getStorageSync(storageKey(accountId))
  return Array.isArray(value) ? value.filter((x): x is PhotoAssociation => !!x && x.accountId === accountId && typeof x.mealId === 'string' && typeof x.filePath === 'string' && Number.isFinite(x.expiresAt)) : []
}
export async function prepareMealPhoto(input: MealPhotoInput): Promise<LocalMealPhoto | undefined> {
  const auth = getAuth()
  if (!auth?.accountId || !input.filePath || input.filePath.startsWith('/assets/')) return undefined
  const filePath = await saveLocalImage(input.filePath,input.retention)
  if (getAuth()?.clientSessionId !== auth.clientSessionId) return undefined
  const expiresAt = retainedImageExpiry(filePath)
  if (expiresAt === null) return undefined
  wx.getFileSystemManager().accessSync(filePath)
  return {accountId:auth.accountId,filePath,expiresAt}
}
export function linkMealPhoto(mealId: string, photo: LocalMealPhoto): void {
  if (!mealId || getAuth()?.accountId !== photo.accountId || photo.expiresAt <= Date.now()) return
  const next = associations(photo.accountId).filter(x=>x.expiresAt>Date.now() && x.mealId!==mealId)
  next.push({...photo,mealId})
  wx.setStorageSync(storageKey(photo.accountId),next)
}
export function mealPhotoPath(mealId: string, now = Date.now()): string {
  const accountId = getAuth()?.accountId
  if (!accountId) return ''
  const photo = associations(accountId).find(x=>x.mealId===mealId && x.expiresAt>now)
  if (!photo) return ''
  try { wx.getFileSystemManager().accessSync(photo.filePath); return photo.filePath } catch { return '' }
}
