import {request,getAuth} from './api'
export interface LabelCandidate {name:string;basis:string|null;ageFromMonths:number|null;ageToMonthsExclusive:number|null;powderGrams:string|null;preparedVolumeMl:string|null;tableFound:boolean;warnings:string[];nutrients:Array<{nutrientCode:string;value:string|null;unitCode:string;chemicalBasis:string;rawText:string}>}
export interface LabelResult {status:string;candidate?:LabelCandidate;matches?:Array<{revisionId:string;name:string}>;evidence?:{id:string;model:string;promptVersion:string;imageSha256:string[]};message?:string;diagnostic?:{code:string;meaning:string;diagnosticId:string}}
const bytes=(s:string)=>{const raw=unescape(encodeURIComponent(s));const b=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)b[i]=raw.charCodeAt(i);return b}
function read(path:string):Promise<ArrayBuffer>{return new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:path,success:r=>typeof r.data==='string'?reject(Error('图片读取格式无效')):resolve(r.data),fail:reject}))}
export async function recognizeMilkLabel(subject:string,milkType:string,date:string,photos:string[],operationId:string,isCurrent:()=>boolean=()=>true):Promise<LabelResult>{
 const auth=getAuth(),identity=(a:ReturnType<typeof getAuth>)=>JSON.stringify([a?.accountId,a?.clientSessionId,a?.clientSessionId?'':a?.accessToken]),owner=identity(auth);
 const boundary='FoodmasterLabel'+Date.now().toString(36),chunks:Uint8Array[]=[];const add=(s:string)=>chunks.push(bytes(s));
 for(const [key,value]of Object.entries({accepted:'true',policyVersion:'milk-label-consent-v1',milkType,recordDate:date,operationId}))add('--'+boundary+'\r\nContent-Disposition: form-data; name="'+key+'"\r\n\r\n'+value+'\r\n');
 let total=0;for(let i=0;i<photos.length;i++){const image=new Uint8Array(await read(photos[i]!));total+=image.byteLength;if(image.byteLength>8*1024*1024||total>16*1024*1024)throw Error('标签图片过大，请压缩后重试');add('--'+boundary+'\r\nContent-Disposition: form-data; name="images"; filename="label'+i+'.jpg"\r\nContent-Type: application/octet-stream\r\n\r\n');chunks.push(image);add('\r\n')}
 add('--'+boundary+'--\r\n');const data=new Uint8Array(chunks.reduce((n,b)=>n+b.length,0));let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length}
 if(!auth||owner!==identity(getAuth())||!isCurrent())throw Error('登录或宝宝状态已变化，请重新打开识别');
 return request<LabelResult>('/subjects/'+subject+'/milk-label-candidates',{method:'POST',data:data.buffer,header:{'content-type':'multipart/form-data; boundary='+boundary}})
}
export function labelConsentKey(){const a=getAuth();return 'foodmaster.milkLabelConsent.v1.'+(a?.accountId||a?.clientSessionId||'')}
export function labelForm(candidate:LabelCandidate,fields:Array<{code:string;value:string;unitCode:string;unit:string}>,replace:boolean){
 return fields.map(f=>{const n=candidate.nutrients.find(n=>n.nutrientCode===f.code);return n&&n.value!==null&&(replace||!f.value)?{...f,value:n.value,labelRawText:n.rawText,unitCode:n.unitCode,unit:n.unitCode==='KILOJOULE'?'千焦':n.unitCode==='KILOCALORIE'?'千卡':n.unitCode==='GRAM'?'克':n.unitCode==='MILLIGRAM'?'毫克':'微克',touched:true}:replace?{...f,value:'',labelRawText:'',touched:true}:f})
}
