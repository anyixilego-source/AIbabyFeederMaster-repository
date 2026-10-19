const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require(process.env.FOODMASTER_TYPESCRIPT);
const root=path.resolve(__dirname,'../../miniprogram');
function load(rel,mocks={},globals={}){const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,rel),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require:n=>n.endsWith('quantity-format')?quantity:mocks[n]||{},console,Date,Math,Number,Promise,...globals});return mod.exports}
const quantity=load('utils/quantity-format.ts'),chart=load('utils/trend-chart.ts'),report=load('utils/nutrition-report.ts'),milk=load('utils/milk-trend.ts',{'./trend-chart':chart}),meal=load('utils/meal-edit.ts',{'./meal-presentation':load('utils/meal-presentation.ts')});
test('all quantity formatters agree without locale APIs and distinguish missing, true zero, and a positive sub-unit value',()=>{
 const original=Number.prototype.toLocaleString;Number.prototype.toLocaleString=function(){throw Error('No locale formatter in this runtime')};
 try{for(const [v,text] of [[15.303,'15'],['117.96','118'],[2.2395,'2'],[1.46565,'1'],[55.755,'56'],['236.66666666666666','237'],[0,'0'],['0.000000','0'],[0.4,'<1'],[0.999,'<1'],[1.5,'2'],[null,'—'],['','—'],[NaN,'—'],[Infinity,'—']]){
  assert.equal(quantity.displayInteger(v),text);assert.equal(report.formatNumber(v),text);if(typeof v==='number')assert.equal(chart.chartNumber(v),text);
 }}finally{Number.prototype.toLocaleString=original}
});
test('report display rounding does not change comparisons, progress or eligibility',()=>{
 const v=report.nutrientView({nutrientCode:'PROTEIN',unitCode:'GRAM',averageDailyValue:'24.99',recommendedValue:'25',upperLimitValue:null,coverageRatio:'1',status:'BELOW_REFERENCE',outputEligibility:'FULL_COMPARISON',numericRelation:'EXACT_BELOW_REFERENCE',statement:'已记录量低于一般参考值',referenceType:'RNI',reasonCodes:[],warnings:[]},[]);
 assert.equal(v.amountText,'25');assert.equal(v.numericValue,24.99);assert.equal(v.numericRelation,'EXACT_BELOW_REFERENCE');assert(v.progressPercent<100);assert.equal(v.status,'BELOW_REFERENCE');
});
test('milk average rounds the true total divided by known-volume days only and never mutates snapshots',()=>{
 const days=['200','250','260',null].map((n,i)=>({date:'2026-10-'+(10+i),reportId:'r'+i,milk:{feedCount:1,knownVolumeMl:n,unknownVolumeEventCount:n===null?1:0,estimatedVolumeRecordCount:0}})),before=JSON.stringify(days);
 const view=milk.milkPeriodView(days);assert.equal(view.totalText,'710');assert.equal(view.averageText,'237');assert.equal(view.knownDays,3);assert.equal(view.bars[3].valueText,'—');assert.equal(JSON.stringify(days),before);
});
test('chart axis labels are integers but plot geometry uses exact fractional values',()=>{
 assert.equal(chart.chartScale([7],[]).step,5);const scale=chart.chartScale([0.2,0.8],[{value:0.4,label:'参考'}]);assert(scale.position(0.8)>scale.position(0.2));assert(scale.ticks.every(t=>/^\d+$/.test(t.text)));assert.equal(scale.axis.find(t=>t.reference).text,'<1');assert.equal(chart.chartNumber(0.4),'<1');
});
test('unchanged historic edit values survive integer input presentation and new fractional edits are rejected',()=>{
 const saved={mealItemId:'item',foodId:'food',selectedFoodRevisionId:'revision',observedName:'历史食物',consumedAmount:'25.512345',servedAmount:'50.123456',unit:'g',status:'CONFIRMED',weightOrigin:'MEASURED',source:'SEARCH'},draft=meal.draftItem(saved);
 assert.equal(draft.input,'26');assert.equal(draft.raw,'25.512345');assert.equal(meal.changedItems([draft]),false);assert.equal(meal.itemPayload([draft])[0].consumedAmount,'25.512345');assert.equal(meal.totalText([draft]),'26');assert.equal(meal.validateItems([draft]),'');
 assert.equal(meal.validateItems([meal.adjustWeight(draft,'26')]),'');assert.equal(meal.itemPayload([meal.adjustWeight(draft,'26')])[0].consumedAmount,'26');assert.equal(meal.adjustWeight(draft,'26').origin,'USER_ACCEPTED_ESTIMATE');assert.match(meal.validateItems([meal.adjustWeight(draft,'26.5')]),/整数/);
});
function resultPage(){let page;load('pages/result/result.ts',{'../../utils/meal-edit':meal,'../../utils/image-retention':{retentionOptions:[]}}, {Page:p=>page=p,wx:{getStorageSync:()=>undefined,getSystemInfoSync:()=>({platform:'test'})}});page.setData=function(v){Object.assign(this.data,v)};page.data.confirmedFoods=[17,54,29].map((ratioPercent,i)=>({localId:String(i),ratioPercent,ratioAdjustedOrder:0}));return page}
test('integer food allocations preserve the confirmed total over totals and uneven ratios without zero-weight selected foods',()=>{
 const p=resultPage();for(const ratios of [[17,54,29],[1,1,98],[33,33,34]]){p.data.confirmedFoods=ratios.map((ratioPercent,i)=>({localId:String(i),ratioPercent,ratioAdjustedOrder:0}));for(let total=3;total<=350;total++){p.onMealTotalInput({detail:{value:String(total)}});const values=p.data.confirmedFoods.map(i=>Number(i.consumedAmount));assert(values.every(n=>Number.isInteger(n)&&n>0));assert.equal(values.reduce((n,v)=>n+v,0),total)}}
 p.onMealTotalInput({detail:{value:'150.5'}});assert(p.data.confirmedFoods.every(i=>i.consumedAmount===''));p.onMealTotalInput({detail:{value:'2'}});assert(p.data.confirmedFoods.every(i=>i.consumedAmount===''));
});
test('recipe and favorite quantities are a rounded projection with unmodified original menu data',()=>{
 const plan=load('utils/diet-plan.ts'),recipe={key:'r',name:'饭',ingredients:[{name:'米',quantity:'25.5',unit:'g'},{name:'水',quantity:'0.4',unit:'ml'},{name:'菜',quantity:'适量',unit:''}]},before=JSON.stringify(recipe),v=plan.recipeDisplay(recipe);
 assert.deepEqual(Array.from(v.ingredients,i=>i.quantity),['26','<1','适量']);assert.equal(JSON.stringify(recipe),before);
});
