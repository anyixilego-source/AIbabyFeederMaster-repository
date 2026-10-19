const familyUnitMocks={familyState:()=>null,canRecordBaby:()=>true,canManageBaby:()=>true,familyGeneration:()=>0,checkFamilyContext:async()=>{},queueSharedMealPhoto(){},retrySharedMealPhotos:async()=>{},sharedMealPhoto:async()=>'',hasCloudPhotoChoice:()=>true,setCloudPhotoConsent(){}};
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require(process.env.FOODMASTER_TYPESCRIPT);
const root=path.resolve(__dirname,'../../miniprogram');
function load(rel,mocks={},globals={}){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,rel),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:n=>/family-state|family-sync|shared-meal-photo/.test(n)?familyUnitMocks:mocks[n]||{},Date,Math,Number,Promise,console,...globals});return m.exports}
const labels={BREAKFAST:'早餐',LUNCH:'午餐',DINNER:'晚餐',SNACK:'点心（按需）'},plan=load('utils/diet-plan.ts'),home=load('utils/home-menu.ts',{'./diet-plan':{slotNames:labels}});
const at=t=>Date.parse('2026-10-16T'+t+':00+08:00');
function latest(date){
 const slots=['DINNER','BREAKFAST','SNACK','LUNCH'];
 const recipes=slots.map(slot=>({key:slot,name:labels[slot]+'菜',texture:'SOFT',preparationMinutes:20}));
 const meals=slots.map(slot=>({slot,recipeKeys:[slot]}));
 return {plan:{taskId:'task',endDate:date,plan:{recipes,days:[{date,meals}]}},task:null};
}
function weeklyModule(){return load('components/diet-recommendation/diet-recommendation.ts',{'../../utils/home-menu':home,'../../utils/diet-plan':plan},{Component(){},setTimeout:()=>1,clearTimeout(){}})}
test('today and tomorrow previews use the current China-time meal at each exact boundary, regardless of source menu order',()=>{
 const weekly=weeklyModule();
 for(const date of ['2026-10-16','2026-10-17'])for(const [time,slot] of [['00:00','BREAKFAST'],['09:59','BREAKFAST'],['10:00','LUNCH'],['14:59','LUNCH'],['15:00','SNACK'],['16:59','SNACK'],['17:00','DINNER'],['20:59','DINNER'],['21:00','SNACK'],['23:59','SNACK']]){
  const data=latest(date),before=JSON.stringify(data),now=at(time),preview=home.homeMenuPreview(data,now),featured=home.homeMenuFeatured(data,preview,now);
  assert.equal(featured.recipeKey,slot,date+' '+time);assert.equal(weekly.weeklyMenuPreview(data.plan,now).featured.key,slot);assert.equal(JSON.stringify(data),before);
 }
});
test('today remains preferred to tomorrow and dates never shift to match the selected meal slot',()=>{
 const data=latest('2026-10-17');data.plan.plan.days.push({...data.plan.plan.days[0],date:'2026-10-16'});const now=at('18:00'),preview=home.homeMenuPreview(data,now);assert.equal(preview.date,'2026-10-16');assert.equal(home.homeMenuFeatured(data,preview,now).recipeKey,'DINNER');
 const tomorrow=latest('2026-10-17'),v=home.homeMenuPreview(tomorrow,now);assert.equal(v.date,'2026-10-17');assert.equal(home.homeMenuFeatured(tomorrow,v,now).recipeKey,'DINNER');
});
test('missing slots fall back to an existing appropriate meal and never invent a dish or show an empty image target',()=>{
 const data=latest('2026-10-16');data.plan.plan.days[0].meals=data.plan.plan.days[0].meals.filter(m=>m.slot!=='SNACK');
 for(const time of ['15:30','22:00'])assert.equal(home.homeMenuFeatured(data,home.homeMenuPreview(data,at(time)),at(time)).recipeKey,'DINNER');
 data.plan.plan.days[0].meals=[{slot:'BREAKFAST',recipeKeys:['BREAKFAST']}];assert.equal(home.homeMenuFeatured(data,home.homeMenuPreview(data,at('18:00')),at('18:00')).recipeKey,'BREAKFAST');
 data.plan.plan.days[0].meals=[];assert.equal(home.homeMenuFeatured(data,home.homeMenuPreview(data,at('18:00')),at('18:00')),null);
});
test('historical menu ordering and date selection remain unchanged',()=>{
 const data=latest('2026-10-10'),meals=data.plan.plan.days[0].meals;assert.equal(home.timeOrderedMenuMeals(meals,'2026-10-10',at('12:00')),meals);assert.equal(weeklyModule().weeklyMenuPreview(data.plan,at('12:00')).featured.key,'DINNER');
});
test('refresh delay lands at the next meal boundary or midnight and never spins at an exact boundary',()=>{
 for(const [time,hours] of [['09:00',1],['10:00',5],['15:00',2],['17:00',4],['21:00',3]])assert.equal(home.nextMenuSlotRefreshIn(at(time)),hours*3600000+250);
 assert.equal(home.nextMenuSlotRefreshIn(at('10:00')-1),251);
 const midnight=Date.parse('2026-10-16T16:00:00Z');assert.equal(home.chinaMenuDates(midnight).today,'2026-10-17');assert.equal(home.homeMenuFeatured(latest('2026-10-17'),home.homeMenuPreview(latest('2026-10-17'),midnight),midnight).recipeKey,'BREAKFAST');
});
test('switching slots changes the image cache key and a delayed previous-slot image cannot replace the new dish',async()=>{
 let now=at('09:00'),page,finish;class Clock extends Date{static now(){return now}}
 const timed=load('utils/home-menu.ts',{'./diet-plan':{slotNames:labels}},{Date:Clock}),data=latest('2026-10-16');
 load('pages/index/index.ts',{'../../utils/home-menu':timed,'../../utils/api':{getAuth:()=>({clientSessionId:'session'}),request:()=>new Promise(r=>finish=r),downloadPrivateRecipeImage:async()=>{throw Error('Old image must not be downloaded')}}},{Date:Clock,Component:p=>page=p,wx:{getSystemInfoSync:()=>({platform:'test'})},getApp:()=>({globalData:{subjectId:'s'}}),setTimeout:()=>1,clearTimeout(){}});
 const p={data:{...page.data,_homeMenuVisible:true,_homeMenuSequence:1,homeMenuSubjectId:'s'},setData(v){Object.assign(this.data,v)},...page.methods};
 p.presentHomeMenu(data,1,false);const key=p.data._homeMenuImageKey,pending=p.loadHomeMenuImage(p.data.homeMenu,p.data.homeMenuFeatured,1,key,'session');now=at('12:00');p.presentHomeMenu(data,1,false);assert.equal(p.data.homeMenuFeatured.recipeKey,'LUNCH');assert.notEqual(p.data._homeMenuImageKey,key);finish({url:'/previous-breakfast'});await pending;assert.equal(p.data.homeMenuImage,'/assets/camera-food-guide-v5.jpg');
});
