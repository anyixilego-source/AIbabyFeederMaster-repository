const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),ts=require(process.env.FOODMASTER_TYPESCRIPT);
const root=path.resolve(__dirname,'../../miniprogram');
function page(request,timer=()=>{},bundle){let result;const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'utils/daily-report-page.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:m,exports:m.exports,getApp:()=>({globalData:{ready:Promise.resolve({subjectId:'subject'})}}),wx:{getStorageSync:()=>0,removeStorageSync:()=>{}},require:p=>p==='./api'?{reviewEnvironment:()=>null,request}:p==='./nutrition-report'?{loadReportBundle:async()=>bundle,nutrientNames:{}}:p==='./knowledge-panel'?{knowledgePanel:()=>({})}:p==='./nutrient-summary-card'?{dailyCards:()=>[]}:p==='./age'?{ageStageFromMonths:()=>''}:{},setTimeout:timer,Page:d=>result=d});m.exports.registerReportPage();result.setData=function(d){Object.assign(this.data,d)};return result;}
test('daily summary and foods share one paragraph; weekly summary stays below its heading',()=>{
 const day=fs.readFileSync(path.join(root,'pages/report/report.wxml'),'utf8'),week=fs.readFileSync(path.join(root,'pages/report-overview/report-overview.wxml'),'utf8');
 assert.match(day,/id="daily-interpretation-summary" class="scope-note">{{interpretationText}}{{foodRecommendationText}}/);assert.ok(!day.includes('id="daily-food-recommendation"'));
 assert.ok(week.indexOf('id="weekly-interpretation-summary"')<week.indexOf('<view wx:if="{{showVersion}}" class="metadata">'));assert.ok(week.includes('营养记录解读</view><text wx:if="{{interpretationText}}" id="weekly-interpretation-summary"'));assert.ok(!day.includes('暂无可展示的解读项'));assert.equal((week.match(/id="weekly-interpretation-summary"/g)||[]).length,1);
});
test('valid saved food suggestions render independently of the main report',async()=>{
 const p=page(async()=>({status:'READY',foods:[{name:'南瓜',preparation:'蒸熟压泥。'}]}));p._loadSequence=1;p.data.reportId='r';await p.loadFoodSuggestions(1,'r',true);
 assert.equal(p.data.foodRecommendationText,'餐食搭配可考虑：南瓜。');assert.equal(p.data.foodPreparationText,'南瓜：蒸熟压泥。');
});
test('late suggestion responses never attach to a changed report or hidden page',async()=>{
 for(const changed of ['sequence','report']){let finish;const pending=new Promise(r=>finish=r);const p=page(()=>pending);p._loadSequence=1;p.data.reportId='r';const action=p.loadFoodSuggestions(1,'r',true);if(changed==='sequence')p._loadSequence=2;else p.data.reportId='new';finish({status:'READY',foods:[{name:'南瓜',preparation:'蒸熟压泥。'}]});await action;assert.equal(p.data.foodRecommendationText,'');assert.equal(p.data.foodSuggestionNote,'正在生成餐食搭配参考…');}
});
test('AI failure and pending results do not invalidate the report',async()=>{
 for(const request of [async()=>{throw Error('offline')},async()=>({status:'PENDING',foods:[]})]){const p=page(request);p._loadSequence=1;p.data.reportId='r';p.data.hasResult=true;p.data.interpretationText='已有总结';await p.loadFoodSuggestions(1,'r',true);assert.equal(p.data.hasResult,true);assert.equal(p.data.interpretationText,'已有总结');assert.equal(p.data.errorMessage,'');}
});
test('clearing report also clears previous food suggestions',()=>{const p=page(async()=>({}));p.data.foodRecommendationText='旧推荐';p.data.foodPreparationText='旧做法';p.data.interpretationText='旧总结';p.clearResult();assert.equal(p.data.foodRecommendationText,'');assert.equal(p.data.foodPreparationText,'');assert.equal(p.data.interpretationText,'');});

test('pending generation retries are bounded and stop after the report changes',async()=>{
 let callback,delay,calls=0;const p=page(async()=>{calls++;return {status:'PENDING',foods:[]}},(cb,ms)=>{callback=cb;delay=ms});p._loadSequence=1;p.data.reportId='r';await p.loadFoodSuggestions(1,'r',true);assert.equal(delay,3000);p.data.reportId='new';callback();assert.equal(calls,1);
});
test('last retry and historical views do not schedule another generation attempt',async()=>{
 for(const [generate,attempt] of [[true,3],[false,0]]){let timers=0;const p=page(async()=>({status:'PENDING',foods:[]}),()=>timers++);p._loadSequence=1;p.data.reportId='r';await p.loadFoodSuggestions(1,'r',generate,attempt);assert.equal(timers,0);}
});

test('a confirmed partial-data meal with no qualified low nutrients still loads food ideas',async()=>{
 let calls=0;const bundle={mealCount:1,foodCount:1,totalConsumedText:'50克',snapshotAvailable:true,subject:{displayName:'合成宝宝'},ageText:'10月龄',dateLabel:'2026-10-14',nutrients:[],updateState:'CURRENT',report:{reportId:'partial',generatedAt:'2026-10-14',result:{assessment:{nutrients:[]},interpretationSummary:{text:'今天已记录铁',focusCodes:[]}}}};
 const p=page(async(url,opts)=>{calls++;assert.equal(url,'/assessment-reports/partial/food-suggestions');assert.equal(opts.data.generate,true);return {status:'READY',foods:[{name:'南瓜',preparation:'蒸熟压泥。'}]}},()=>{},bundle);await p.loadReport();await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.match(p.data.foodRecommendationText,/南瓜/);assert.equal(p.data.errorMessage,'');
});

test('extra explanation and loading/failure text stay in folded notes, not the approved paragraph',async()=>{
 const markup=fs.readFileSync(path.join(root,'pages/report/report.wxml'),'utf8');const folded=markup.indexOf('<view wx:if="{{showVersion}}">');assert.ok(markup.indexOf('id="food-suggestion-scope"')>folded);assert.ok(markup.indexOf('id="food-suggestion-status"')>folded);
 const p=page(async()=>{throw Error('offline')});p._loadSequence=1;p.data.reportId='r';p.data.interpretationText='今天已记录铁营养素的摄入。';await p.loadFoodSuggestions(1,'r',true);assert.equal(p.data.interpretationText,'今天已记录铁营养素的摄入。');assert.equal(p.data.foodRecommendationText,'');assert.match(p.data.foodSuggestionNote,/暂未生成/);
});
