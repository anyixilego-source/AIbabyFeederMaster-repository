import {canRecordBaby} from '../../utils/family-state'
import { displayInteger } from '../../utils/quantity-format'
import {backPage,openPage} from '../../utils/navigation'
import {request,reviewEnvironment} from '../../utils/api'
import {loadPeriod} from '../../utils/nutrition-period'
import {milkPeriodView,milkRecordView} from '../../utils/milk-trend'
import type {MilkSnapshotRecord} from '../../utils/milk-trend'
import {ensureSessionContext} from '../../utils/session'

function dateOnly(date:Date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function shortDate(value:string,year=false){const [y,m,d]=value.split('-');return value?`${year?y+'年':''}${Number(m)}月${Number(d)}日`:''}
function integerMl(value:string){return value.startsWith('<') ? value : displayInteger(value.replace(/^约/,'').replace(/,/g,''))}
function recordView(record:MilkSnapshotRecord,offset:number){return {...milkRecordView(record,offset),volumeText:record.volumeMl===null?'仅记录喂养事件':integerMl(record.volumeMl)+' ml'}}

Page({
 data:{subjectId:'',showCalendar:false,loading:false,errorMessage:'',periodId:'',startDate:'',endDate:'',rangeLabel:'',today:dateOnly(new Date()),selectedDate:'',selectedDateLabel:'',selectedCount:0,totalText:'—',averageText:'—',averageLabel:'暂无有量日',totalLong:false,averageLong:false,wideAxis:false,knownDays:0,feedCount:0,unknownCount:0,axis:[] as ReturnType<typeof milkPeriodView>['axis'],ticks:[] as ReturnType<typeof milkPeriodView>['ticks'],bars:[] as ReturnType<typeof milkPeriodView>['bars'],records:[] as ReturnType<typeof recordView>[],detailUnavailable:false,showInfo:false,reviewLabel:reviewEnvironment()?.label||''},
 _sequence:0,_loaded:false,_visible:true,_scroll:0,_returnFromEdit:false,_editEpoch:0,_days:[] as Array<{date:string;records:ReturnType<typeof recordView>[];unavailable:boolean}>,
 onLoad(q:Record<string,string>){this.setData({periodId:q.periodId||''});void this.load()},
 onShow(){this._visible=true;this.setData({today:dateOnly(new Date())});if(this._returnFromEdit){this._returnFromEdit=false;if(Number(wx.getStorageSync('foodmaster.recordEpoch')||0)!==this._editEpoch){this.setData({periodId:''});void this.load();return}}if(this._loaded)wx.pageScrollTo({scrollTop:this._scroll,duration:0});else if(!this.data.loading)void this.load()},
 onHide(){this._visible=false;++this._sequence;this.setData({loading:false})},
 onUnload(){this._visible=false;++this._sequence},
 onPageScroll(e:{scrollTop:number}){this._scroll=e.scrollTop},
 async load(){
  const seq=++this._sequence;this._loaded=false;this.setData({loading:true,errorMessage:''});
  try{
   const app=getApp<IAppOption>(),ctx=await(app.globalData.ready||ensureSessionContext());
   if(!ctx.subjectId||!this.data.periodId&&!this.data.endDate)throw Error('请从近7日报告进入');
   const period=await loadPeriod(ctx.subjectId,this.data.endDate||undefined,this.data.periodId||undefined);
   if(seq!==this._sequence||!this._visible)return;
   const days=period.result.dates,details=new Array<{date:string;records:ReturnType<typeof recordView>[];unavailable:boolean}>(days.length);let next=0;
   await Promise.all(Array.from({length:Math.min(3,days.length)},async()=>{
    while(next<days.length&&seq===this._sequence&&this._visible){
     const index=next++,day=days[index];
     const r=await request<{subjectId:string;result:{milk?:{records:MilkSnapshotRecord[]}}}>('/assessment-reports/'+day.reportId);
     if(r.subjectId!==ctx.subjectId)throw Error('报告所属宝宝不一致');
     details[index]={date:day.date,records:(r.result.milk?.records||[]).map(x=>recordView(x,period.timezoneOffsetMinutes)).sort((a,b)=>b.time.localeCompare(a.time)),unavailable:!r.result.milk};
    }
   }));
   if(seq!==this._sequence||!this._visible)return;
   const view=milkPeriodView(days),totalText=integerMl(view.totalText),averageText=integerMl(view.averageText);
   this._days=details;this._loaded=true;
   const crossYear=period.startDate.slice(0,4)!==period.endDate.slice(0,4);
   this.setData({...view,subjectId:ctx.subjectId,bars:view.bars.map(b=>({...b,label:Number(b.date.slice(5,7))+'/'+Number(b.date.slice(8,10))})),wideAxis:view.axis.some(a=>a.text.length>6),periodId:period.periodReportId,startDate:period.startDate,endDate:period.endDate,rangeLabel:shortDate(period.startDate,crossYear)+' — '+shortDate(period.endDate,crossYear),totalText,averageText,totalLong:totalText.length>7,averageLong:averageText.length>7,averageLabel:view.knownDays?'按'+view.knownDays+'日平均':'暂无有量日'});
   const selected=days.some(d=>d.date===this.data.selectedDate)?this.data.selectedDate:[...days].reverse().find(d=>d.milk?.feedCount)?.date||period.endDate;
   this.present(selected);
  }catch(e){
   if(seq!==this._sequence||!this._visible)return;
   this._loaded=false;this._days=[];this.setData({bars:[],records:[],errorMessage:e instanceof Error?e.message:'奶量趋势暂不可用，请重试'});
  }finally{if(seq===this._sequence&&this._visible)this.setData({loading:false})}
 },
 present(date:string){const d=this._days.find(d=>d.date===date),bar=this.data.bars.find(b=>b.date===date);this.setData({selectedDate:date,selectedDateLabel:shortDate(date),selectedCount:bar?.feedCount||d?.records.length||0,records:d?.records||[],detailUnavailable:d?.unavailable||false})},
 selectDay(e:WechatMiniprogram.TouchEvent){const date=String(e.currentTarget.dataset.date);if(this.data.bars.some(b=>b.date===date))this.present(date)},
 openCalendar(){if(!this.data.loading)this.setData({showCalendar:true})},
 closeCalendar(){this.setData({showCalendar:false})},
 changeDate(e:WechatMiniprogram.CustomEvent<{value:string}>){
  const value=String(e.detail.value),parsed=new Date(value+'T00:00:00');
  if(this.data.loading||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(parsed.getTime())||dateOnly(parsed)!==value||value>dateOnly(new Date())||value===this.data.endDate)return;
  this.setData({endDate:value,periodId:'',selectedDate:'',showCalendar:false});this._scroll=0;void this.load();
 },
 openRecord(e:WechatMiniprogram.TouchEvent){if(!canRecordBaby()){wx.showToast({title:'当前为仅查看权限，记录详情已展示在列表中',icon:'none'});return}const item=this.data.records.find(r=>r.milkRecordId===String(e.currentTarget.dataset.id));if(!item||!this.data.subjectId||this._returnFromEdit)return;this._editEpoch=Number(wx.getStorageSync('foodmaster.recordEpoch')||0);this._returnFromEdit=true;openPage('/pages/records/records?fromMilkTrend=1&milkRecordId='+encodeURIComponent(item.milkRecordId)+'&subjectId='+encodeURIComponent(this.data.subjectId),{fail:()=>{this._returnFromEdit=false;wx.showToast({title:'编辑暂未打开，请重试',icon:'none'})}})},
 toggleInfo(){this.setData({showInfo:!this.data.showInfo})},
 retry(){void this.load()},goBack(){backPage('/pages/report-overview/report-overview',this)}
})
