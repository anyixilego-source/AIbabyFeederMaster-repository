import {ApiError,getAuth,request} from '../../utils/api'
import {canRecordBaby,familyGeneration} from '../../utils/family-state'
import {pendingRecord,submitRecord} from '../../utils/record-submit'
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
interface WeightResponse {revision:number;selected:{weightKg:string;measuredOn:string}|null}
Component({properties:{visible:{type:Boolean,value:false},subjectId:{type:String,value:''},reportDate:{type:String,value:''},applyToReport:{type:Boolean,value:false}},
 data:{attempt:0,weight:'',measuredOn:'',maxDate:'',revision:0,loading:false,saving:false,retrying:false,error:''},
 observers:{'visible,subjectId,reportDate':function(visible:boolean){++this.data.attempt;if(visible)void this.loadWeight(false)}},
 lifetimes:{detached(){++this.data.attempt}},
 methods:{
  scope(){return [getAuth()?.clientSessionId||'',familyGeneration(),this.properties.subjectId,this.properties.reportDate].join('|')},

  async loadWeight(keepInput=false){const attempt=++this.data.attempt,scope=this.scope(),subject=this.properties.subjectId,day=this.properties.reportDate||today();if(!subject)return;this.setData({loading:true,error:'',maxDate:this.properties.applyToReport&&day<today()?day:today(),...(!keepInput?{weight:'',measuredOn:day,revision:0,retrying:false}:{})});
   try{const previous=pendingRecord('weight:'+subject);if(previous)this.setData({weight:String(previous.payload.weightKg||''),measuredOn:String(previous.payload.measuredOn||day),retrying:true});
    const response=await request<WeightResponse>('/subjects/'+subject+'/weight?reportDate='+day);if(attempt!==this.data.attempt||scope!==this.scope()||!this.properties.visible)return;
    const pending=pendingRecord('weight:'+subject),values=pending?.payload;
    this.setData({revision:response.revision,retrying:!!pending,...(values?{weight:String(values.weightKg||''),measuredOn:String(values.measuredOn||day)}:keepInput?{}:{weight:response.selected?String(Number(response.selected.weightKg)):'',measuredOn:response.selected?.measuredOn||day})});
   }catch(e){if(attempt===this.data.attempt&&scope===this.scope())this.setData({error:e instanceof Error?e.message:'体重资料暂不可用'});}finally{if(attempt===this.data.attempt)this.setData({loading:false});}
  },
  close(){if(!this.data.saving)this.triggerEvent('close')},
  noop(){},
  inputWeight(e:WechatMiniprogram.Input){if(!this.data.loading&&!this.data.saving&&!this.data.retrying)this.setData({weight:e.detail.value,error:''})},
  changeDate(e:WechatMiniprogram.PickerChange){if(!this.data.loading&&!this.data.saving&&!this.data.retrying)this.setData({measuredOn:String(e.detail.value),error:''})},
  async saveWeight(){if(this.data.loading||this.data.saving||!canRecordBaby())return;const weight=this.data.weight.trim();
   if(!/^\d{1,3}(?:\.\d)?$/.test(weight)||Number(weight)<=0||Number(weight)>999.9){this.setData({error:'体重请填写正数公斤，最多1位小数'});return;}
   if(!/^\d{4}-\d{2}-\d{2}$/.test(this.data.measuredOn)||this.data.measuredOn>this.data.maxDate){this.setData({error:'请核对测量日期'});return;}
   const attempt=this.data.attempt,scope=this.scope(),subject=this.properties.subjectId,reportDate=this.properties.reportDate||today();this.setData({saving:true,error:''});
   try{const response=await submitRecord<Record<string,unknown>>('weight:'+subject,'/subjects/'+subject+'/weight','POST','SAVE_SUBJECT_WEIGHT',{weightKg:weight,measuredOn:this.data.measuredOn,expectedRevision:this.data.revision,...(this.properties.applyToReport?{applyToReportDate:reportDate}:{})});
    if(attempt!==this.data.attempt||scope!==this.scope()||!this.properties.visible)return;
    wx.setStorageSync('foodmaster.recordEpoch',Number(wx.getStorageSync('foodmaster.recordEpoch')||0)+1);
    this.triggerEvent('saved',{response,reportDate});this.triggerEvent('close');
   }catch(e){if(attempt!==this.data.attempt||scope!==this.scope())return;const message=e instanceof Error?e.message:'保存结果待核对，请重试';
    if(e instanceof ApiError&&e.statusCode===409)await this.loadWeight(true);
    this.setData({error:message,retrying:!!pendingRecord('weight:'+subject)});
   }finally{if(scope===this.scope())this.setData({saving:false});}
  },
 }
})
