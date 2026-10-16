export interface AiDiagnostic {diagnosticId:string;occurredAt:string;provider:string|null;source:string;code:string;meaning:string;suggestion:string}
export interface AiFailureView {title:string;feature:string;provider:string;source:string;code:string;codeLabel:string;meaning:string;suggestion:string;diagnosticId:string;occurredAt:string;extra:string}
const providers=['DeepSeek','Pollinations','硅基流动'];
const meanings:Record<string,string>={'400':'AI接口未接受请求格式','401':'AI接口认证失败','402':'AI服务账户余额不足','403':'AI接口拒绝访问','422':'AI接口未接受请求参数','429':'AI接口请求过多','500':'AI服务内部异常','503':'AI服务繁忙',AI_TIMEOUT:'等待AI服务响应超时',AI_NETWORK_ERROR:'连接AI服务失败',AI_INVALID_RESPONSE:'AI返回内容无法读取',AI_OUTPUT_REJECTED:'AI结果未通过完整性或安全核对',AI_NOT_CONFIGURED:'AI服务尚未配置',AI_UNAVAILABLE:'本次AI调用未完成，未取得具体接口错误码',RESULT_SAVE_FAILED:'生成结果暂未保存成功'};
export function aiFailureView(value:unknown,feature:'图片识别'|'菜单生成'|'菜品图片',extra=''):AiFailureView {
 const d=(value&&typeof value==='object'?value:{}) as Partial<AiDiagnostic>;
 const valid=typeof d.code==='string'&&(Object.prototype.hasOwnProperty.call(meanings,d.code)||/^[45]\d{2}$/.test(d.code))&&typeof d.diagnosticId==='string'&&/^FM-[0-9a-f-]{36}$/i.test(d.diagnosticId);
 const code=valid?d.code!:'AI_UNAVAILABLE',provider=valid&&providers.includes(d.provider||'')?d.provider!:'',source=valid&&['UPSTREAM','OUTPUT','APPLICATION'].includes(d.source||'')?d.source!:'UNKNOWN';
 return {title:feature==='图片识别'?'AI识别暂未完成':feature==='菜单生成'?'菜单暂未生成':'示意图暂未生成',feature,provider,source,code,codeLabel:/^\d{3}$/.test(code)?'接口错误码':'诊断码',meaning:meanings[code]||'AI接口返回异常',suggestion:['400','401','402','403','422','AI_NOT_CONFIGURED'].includes(code)?'请复制错误信息反馈给开发者，用户无需重新登录或充值。':code==='AI_OUTPUT_REJECTED'?'请核对条件后重新生成。':feature==='图片识别'?'请稍后重试，或先使用手动记录。':'请稍后重试，或复制错误信息反馈给开发者。',diagnosticId:valid?d.diagnosticId!:'FM-CLIENT-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10),occurredAt:valid&&typeof d.occurredAt==='string'&&Number.isFinite(Date.parse(d.occurredAt))?new Date(d.occurredAt).toISOString():new Date().toISOString(),extra};
}
export function aiFailureText(v:AiFailureView):string {return (v.provider?v.provider+'：':'')+v.meaning+'（'+v.codeLabel+'：'+v.code+'）\n'+v.suggestion+(v.extra?'\n'+v.extra:'')+'\n诊断编号：'+v.diagnosticId}
export function notifyAiFailure(v:AiFailureView){void wx.showModal({title:v.title,content:aiFailureText(v),showCancel:false,confirmText:'我知道了'})}
export function copyAiFailure(v:AiFailureView){let version='开发版';try{const info=wx.getAccountInfoSync().miniProgram;version=info.version||info.envVersion||version}catch{/* No account metadata in isolated tests. */}
 // Explicit fields only; never copy request bodies, names, images or provider responses.
 const data=['功能：'+v.feature,'时间：'+v.occurredAt,'服务：'+(v.provider||'未取得具体服务信息'),'错误来源：'+v.source,v.codeLabel+'：'+v.code,'含义：'+v.meaning,'诊断编号：'+v.diagnosticId,'版本：'+version].join('\n');
 wx.setClipboardData({data,success(){wx.showToast({title:'错误信息已复制',icon:'none',duration:1500})},fail(){wx.showToast({title:'复制未完成，请重试',icon:'none'})}});
}
