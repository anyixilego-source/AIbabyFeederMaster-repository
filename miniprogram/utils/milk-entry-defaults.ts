import { integerInput } from './quantity-format'
import {getAuth} from './api'
export interface MilkEntryDefaults {milkType:string;volume:string;eventOnly:boolean}
const types=['FORMULA','LIQUID_MILK','EXPRESSED_BREAST_MILK','DIRECT_BREASTFEEDING'];
export function milkEntryOwner():string {const auth=getAuth();return auth?.accountId||auth?.clientSessionId||''}
function normalise(value:unknown):MilkEntryDefaults|null {if(!value||typeof value!=='object')return null;const v=value as Record<string,unknown>;if(!types.includes(String(v.milkType)))return null;const eventOnly=v.eventOnly===true,raw=typeof v.volume==='string'?v.volume:'',volume=integerInput(raw);if(!eventOnly&&!(/^\d+$/.test(volume)&&Number(volume)>0&&Number(volume)<=1000000))return null;return {milkType:String(v.milkType),eventOnly,volume:eventOnly?'':volume}}
function key(subjectId:string,owner:string){return 'foodmaster.milk-entry.v1:'+owner+':'+subjectId}
export function readMilkEntryDefaults(subjectId:string):MilkEntryDefaults|null {const owner=milkEntryOwner();if(!owner||!subjectId)return null;try{return normalise(wx.getStorageSync(key(subjectId,owner)))}catch{return null}}
export function rememberMilkEntry(subjectId:string,value:unknown,owner:string):void {if(!subjectId||!owner||owner!==milkEntryOwner())return;const entry=normalise(value);if(!entry)return;try{wx.setStorageSync(key(subjectId,owner),entry)}catch{/* Remembering defaults must not change a successful record into a failed save. */}}
