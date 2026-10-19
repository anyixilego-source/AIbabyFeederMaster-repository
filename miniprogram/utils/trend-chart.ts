import { displayInteger } from './quantity-format'
export interface ChartAxisLabel { key:string; text:string; bottom:number; reference:boolean; alternate:boolean }
export function chartNumber(value:number):string {
  return displayInteger(value)
}
function tidy(value:number) { return Number(value.toPrecision(12)) }
export function chartScale(values:number[], references:Array<{value:number; label:string}>) {
  const finite=[...values,...references.map(r=>r.value)].filter(v=>Number.isFinite(v)&&v>=0)
  const peak=Math.max(0,...finite), ceiling=peak>0?peak*1.18:1
  const raw=ceiling/4, power=10**Math.floor(Math.log10(raw))
  const factor=[1,2,2.5,5,10].find(v=>v>=raw/power&&Number.isInteger(tidy(v*power))) || 10
  const step=Math.max(1,tidy(factor*power)), max=tidy(Math.ceil(ceiling/step)*step)
  const position=(value:number)=>Number((Math.max(0,value)/max*100).toFixed(6))
  const ticks=Array.from({length:Math.round(max/step)+1},(_,i)=>{
    const value=tidy(i*step)
    return {key:'tick-'+i,text:chartNumber(value),bottom:position(value),reference:false,alternate:false}
  })
  const unique=references.filter(r=>Number.isFinite(r.value)&&r.value>=0).filter((r,i,all)=>all.findIndex(x=>x.value===r.value)===i)
  const refLabels=unique.map((r,i)=>({key:'reference-'+i,text:chartNumber(r.value),bottom:position(r.value),reference:true,alternate:i>0&&unique.slice(0,i).some(x=>Math.abs(position(x.value)-position(r.value))<9)}))
  const axis:ChartAxisLabel[]=[...ticks.filter(t=>!refLabels.some(r=>Math.abs(t.bottom-r.bottom)<8)),...refLabels].sort((a,b)=>a.bottom-b.bottom)
  return {max,step,ticks,axis,wideAxis:refLabels.some(r=>r.alternate),position}
}
