import {copyAiFailure,type AiFailureView} from '../../utils/ai-failure'
Component({properties:{failure:{type:Object,value:{}},retryLabel:{type:String,value:''},manual:{type:Boolean,value:false}},methods:{copy(){if(this.data.failure?.diagnosticId)copyAiFailure(this.data.failure as AiFailureView)},retry(){this.triggerEvent('retry')},manualEntry(){this.triggerEvent('manual')}}})
