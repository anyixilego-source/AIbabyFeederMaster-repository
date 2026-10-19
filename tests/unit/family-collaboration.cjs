const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require(process.env.FOODMASTER_TYPESCRIPT),base=path.resolve(__dirname,'../../miniprogram');
const owner={subjectId:'baby-a',householdId:'house-a',displayName:'原宝宝',birthDate:'2024-01-01',sex:'UNSPECIFIED',sharedVersion:'1',role:'OWNER',canRecord:true,canManage:true};
const shared={...owner,subjectId:'baby-b',householdId:'house-b',displayName:'共享宝宝',role:'CAREGIVER',canManage:false};
function harness(){
 const store=new Map(),files=new Map(),calls=[],modals=[],toasts=[],routes=[],timers=new Set(),cache=new Map(),app={globalData:{}},pages=[];let handler=async()=>({}),uploaded=async()=>({photoId:'photo'}),pageDefinition;
 const wx={env:{USER_DATA_PATH:'/private'},getSystemInfoSync:()=>({platform:'test'}),getStorageSync:k=>store.get(k),setStorageSync:(k,v)=>store.set(k,v),removeStorageSync:k=>store.delete(k),login:o=>o.success({code:'code'}),
  request:o=>{calls.push({kind:'request',url:o.url,method:o.method||'GET',data:o.data,header:o.header});Promise.resolve().then(()=>handler(o)).then(r=>o.success({statusCode:r?.http||200,data:r?.http?r.data:r}),e=>o.fail({errMsg:e.message}));return {abort(){}}},
  uploadFile:o=>{calls.push({kind:'upload',...o});Promise.resolve().then(()=>uploaded(o)).then(r=>o.success({statusCode:200,data:JSON.stringify(r)}),e=>o.fail({errMsg:e.message}));return {abort(){}}},
  showToast:o=>toasts.push(o.title),showModal:o=>{modals.push(o);o.success?.({confirm:true,cancel:false})},showActionSheet(){},
  getFileSystemManager:()=>({readdirSync:()=>[...files.keys()].map(p=>p.split('/').pop()),unlinkSync:p=>files.delete(p),accessSync:p=>{if(!files.has(p))throw Error('missing')},writeFile:o=>{files.set(o.filePath,o.data);o.success()},}),
  nextTick:fn=>fn(),pageScrollTo(){},setStorage(){},
 };
 const globals={wx,getApp:()=>app,getCurrentPages:()=>pages,Page:p=>pageDefinition=p,Component:p=>pageDefinition=p,console,Date,Promise,Math,Number,Error,ArrayBuffer,Uint8Array,Map,Set,setTimeout:()=>1,clearTimeout(){},setInterval:f=>{timers.add(f);return f},clearInterval:f=>timers.delete(f)};
 function load(rel){rel=rel.replaceAll('\\','/');if(cache.has(rel))return cache.get(rel).exports;
  if(rel==='config.ts')return {apiBaseUrl:'https://synthetic.invalid/api/v1'};
  if(rel==='utils/navigation.ts')return {navigateRoot:r=>routes.push(r),backPage:r=>routes.push(r)};
  const m={exports:{}};cache.set(rel,m);const code=ts.transpileModule(fs.readFileSync(path.join(base,rel),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{...globals,module:m,exports:m.exports,require:n=>{if(!n.startsWith('.'))throw Error(n);return load(path.posix.normalize(path.posix.join(path.posix.dirname(rel),n))+'.ts')}},{filename:rel});return m.exports;
 }
 const api=load('utils/api.ts');api.setAuth({accountId:'account-a',clientSessionId:'session-a',accessToken:'synthetic-access',refreshToken:'synthetic-refresh'});
 function familyBackend(choices=[owner,shared]){handler=async o=>{if(o.url.endsWith('/households'))return [{householdId:'house-a',role:'OWNER'},{householdId:'house-b',role:'VIEWER'}];if(o.url.endsWith('/family/subjects'))return choices;if(o.url.endsWith('/context'))return choices.find(s=>o.url.includes(s.subjectId))||{http:403,data:{message:'撤权'}};throw Error('Unexpected route')};}
 function page(){const p=pageDefinition;p.setData=function(patch){for(const [k,v] of Object.entries(patch)){const parts=k.split('.');let obj=this.data;for(const key of parts.slice(0,-1))obj=obj[key];obj[parts.at(-1)]=v}};return p;}
 return {api,load,store,files,calls,modals,toasts,routes,timers,app,pages,page,familyBackend,setHandler:f=>handler=f,setUpload:f=>uploaded=f};
}
test('all accessible babies are retained; remembered selection survives refresh',async()=>{
 const h=harness();h.familyBackend();const session=h.load('utils/session.ts');let ctx=await session.refreshSessionContext();assert.equal(ctx.subjectId,owner.subjectId);assert.equal(ctx.subjects.length,2);
 ctx=await session.refreshSessionContext(shared.subjectId);assert.equal(ctx.subjectId,shared.subjectId);assert.equal(ctx.householdId,shared.householdId);assert.equal((await session.refreshSessionContext()).subjectId,shared.subjectId);
});
test('revoked selected baby falls back to an accessible original baby without deleting data',async()=>{
 const h=harness();h.familyBackend();const session=h.load('utils/session.ts');await session.refreshSessionContext(shared.subjectId);h.familyBackend([owner]);const ctx=await session.refreshSessionContext();assert.equal(ctx.subjectId,owner.subjectId);assert.equal(h.calls.filter(c=>c.method==='DELETE').length,0);
});
test('server not yet deployed keeps single user pages available, without claiming family support',async()=>{
 const h=harness();h.setHandler(async o=>o.url.endsWith('/family/subjects')?{http:404,data:{message:'not found'}}:o.url.endsWith('/households')?[{householdId:'house-a',role:'OWNER'}]:[owner]);const ctx=await h.load('utils/session.ts').refreshSessionContext();assert.equal(ctx.current.sharedVersion,'legacy');assert.equal(ctx.subjectId,owner.subjectId);
});
test('late report response cannot cross a baby switch',async()=>{
 const h=harness(),state=h.load('utils/family-state.ts');state.setFamilyState(owner);let release;h.setHandler(()=>new Promise(r=>release=r));const p=h.api.request('/assessment-reports/synthetic');await new Promise(r=>setImmediate(r));state.setFamilyState(shared);release({private:'old baby data'});await assert.rejects(p,/宝宝或权限已变化/);
});
test('VIEWER can read but cannot submit shared records even through a direct page action',async()=>{
 const h=harness();h.load('utils/family-state.ts').setFamilyState({...shared,role:'VIEWER',canRecord:false});h.setHandler(async()=>({items:[]}));assert.deepEqual(await h.api.request('/subjects/baby-b/milk-records'),{items:[]});await assert.rejects(h.api.request('/subjects/baby-b/milk-records',{method:'POST',data:{volumeMl:'100'}}),e=>e.statusCode===403);assert.equal(h.calls.length,1);
});
test('photo upload retries use one operation and never resubmit or recognize a meal',async()=>{
 const h=harness();h.load('utils/family-state.ts').setFamilyState(shared);const photos=h.load('utils/shared-meal-photo.ts');photos.setCloudPhotoConsent(shared.subjectId,true);photos.queueSharedMealPhoto('meal-one',shared.subjectId,'/private/original.jpg',Date.now()+100000);h.setUpload(async()=>{throw Error('offline')});await photos.retrySharedMealPhotos();const first=h.calls[0].formData.operationId;
 h.setUpload(async()=>({photoId:'one'}));await photos.retrySharedMealPhotos();assert.equal(h.calls[1].formData.operationId,first);assert(h.calls.every(c=>c.kind==='upload'&&c.url.endsWith('/meals/meal-one/photo')));await photos.retrySharedMealPhotos();assert.equal(h.calls.length,2);
});
test('no photo consent and another baby never upload old local photos',async()=>{
 const h=harness(),state=h.load('utils/family-state.ts'),photos=h.load('utils/shared-meal-photo.ts');state.setFamilyState(shared);photos.queueSharedMealPhoto('meal',shared.subjectId,'/private/photo.jpg',Date.now()+10000);await photos.retrySharedMealPhotos();assert.equal(h.calls.length,0);photos.setCloudPhotoConsent(shared.subjectId,true);photos.queueSharedMealPhoto('meal',shared.subjectId,'/private/photo.jpg',Date.now()+10000);state.setFamilyState(owner);await photos.retrySharedMealPhotos();assert.equal(h.calls.length,0);
});
test('expired metadata never downloads, and a photo arriving after switch is discarded',async()=>{
 const h=harness(),state=h.load('utils/family-state.ts'),photos=h.load('utils/shared-meal-photo.ts');state.setFamilyState(shared);h.setHandler(async()=>({photo:{photoId:'id',expiresAt:new Date(Date.now()-1).toISOString()}}));assert.equal(await photos.sharedMealPhoto('meal',shared.subjectId),'');assert.equal(h.calls.length,1);
 let release;h.setHandler(async o=>o.url.endsWith('/photo')?{photo:{photoId:'id',expiresAt:new Date(Date.now()+100000).toISOString()}}:new Promise(r=>release=r));const pending=photos.sharedMealPhoto('meal',shared.subjectId);await new Promise(r=>setImmediate(r));state.setFamilyState(owner);release(new Uint8Array([255,216,255]).buffer);await assert.rejects(pending,/宝宝或权限已变化/);assert.equal(h.files.size,0);
});
test('shared version refresh preserves an open milk editor instead of overwriting input',async()=>{
 const h=harness(),state=h.load('utils/family-state.ts');state.setFamilyState(shared);let loads=0;h.app.globalData.ready=Promise.resolve({subjectId:shared.subjectId,current:shared});h.pages.push({route:'pages/records/records',data:{milkPanel:{visible:true,volume:'123'}},setData(){},loadMeals:async()=>loads++});h.setHandler(async()=>({...shared,sharedVersion:'2'}));await h.load('utils/family-sync.ts').checkFamilyContext();assert.equal(loads,0);assert.equal(h.pages[0].data.milkPanel.volume,'123');assert.match(h.toasts[0],/输入已保留/);
});
test('background stops polling and revocation clears retained views before choosing another baby',async()=>{
 const h=harness(),state=h.load('utils/family-state.ts');state.setFamilyState(shared);h.app.globalData.ready=Promise.resolve({subjectId:shared.subjectId});h.pages.push({route:'pages/records/records',data:{},setData(v){Object.assign(this.data,v)}});h.setHandler(async o=>o.url.endsWith('/context')?{http:403,data:{message:'撤权'}}:o.url.endsWith('/households')?[{householdId:'house-a',role:'OWNER'}]:[owner]);const sync=h.load('utils/family-sync.ts');sync.startFamilySync();assert.equal(h.timers.size,1);sync.stopFamilySync();assert.equal(h.timers.size,0);await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.equal(h.pages[0].data.canRecord,false);assert.equal(h.pages[0].data.subjectId,'');assert.equal(h.routes.at(-1),'/pages/profile/profile');
});
test('invite sharing keeps credentials in memory and excludes profile and login tokens',()=>{
 const h=harness();h.load('pages/family/family.ts');const p=h.page();p._inviteToken='synthetic-invite';const result=p.onShareAppMessage();assert.equal(result.path,'/pages/family-join/family-join?invite=synthetic-invite');assert.doesNotMatch(JSON.stringify(result),/synthetic-access|birthDate|householdId/);p.onUnload();assert.equal(p._inviteToken,'');assert(![...h.store.keys()].some(k=>k.includes('invite')));
});
test('a save already in flight keeps its receipt operation after a baby switch',async()=>{
 const h=harness(),state=h.load('utils/family-state.ts'),submit=h.load('utils/record-submit.ts');state.setFamilyState(shared);
 let release;h.setHandler(()=>new Promise(r=>release=r));const scope='meal-create:'+shared.subjectId;
 const first=submit.submitRecord(scope,'/subjects/'+shared.subjectId+'/meals/confirmed','POST','CREATE_CONFIRMED_MEAL',{items:[]});await new Promise(r=>setImmediate(r));state.setFamilyState(owner);release({mealId:'saved-original'});
 await assert.rejects(first,/宝宝或权限已变化/);const pending=submit.pendingRecord(scope);assert(pending);assert.equal(pending.subjectId,shared.subjectId);
 await assert.rejects(submit.submitRecord(scope,'/subjects/'+owner.subjectId+'/meals/confirmed','POST','CREATE_CONFIRMED_MEAL',{items:[]}),/切回原宝宝/);
 state.setFamilyState(shared);h.setHandler(async()=>({status:'COMPLETED',response:{mealId:'saved-original'}}));const saved=await submit.submitRecord(scope,'/subjects/'+shared.subjectId+'/meals/confirmed','POST','CREATE_CONFIRMED_MEAL',{items:[]});assert.equal(saved.mealId,'saved-original');assert.equal(h.calls.filter(c=>c.method==='POST').length,1);assert.equal(submit.pendingRecord(scope),undefined);
});
test('several shared babies without a remembered or owned baby require an explicit selection',async()=>{
 const h=harness();h.familyBackend([shared,{...shared,subjectId:'baby-c',displayName:'另一个共享宝宝'}]);const ctx=await h.load('utils/session.ts').refreshSessionContext();assert.equal(ctx.subjectId,null);assert.equal(ctx.subjects.length,2);
});
test('a delayed action cannot start a new write for the previous baby after switching',async()=>{
 const h=harness();h.load('utils/family-state.ts').setFamilyState(owner);await assert.rejects(h.api.request('/subjects/baby-b/meals/confirmed',{method:'POST',data:{items:[]}}),e=>e.statusCode===409&&e.data.code==='FAMILY_CONTEXT_CHANGED');assert.equal(h.calls.length,0);
});
test('cold invitation entry logs in and applies without creating or switching a baby before approval',async()=>{
 const h=harness();h.api.clearAuth();h.setHandler(async o=>{
  if(o.url.endsWith('/identity/wechat/login'))return {accountId:'new-account',accessToken:'new-synthetic',refreshToken:'new-refresh'};
  if(o.url.endsWith('/households'))return [{householdId:'new-house',role:'OWNER'}];if(o.url.endsWith('/family/subjects'))return [];
  if(o.url.endsWith('/invitations/preview'))return {role:'VIEWER',displayName:'外婆',state:'UNCLAIMED',subjectId:null};if(o.url.endsWith('/invitations/apply'))return {state:'PENDING'};throw Error('Unexpected route');
 });h.load('pages/family-join/family-join.ts');const p=h.page();p.onLoad({invite:'synthetic'});await new Promise(r=>setImmediate(r));assert.equal(p.data.state,'UNCLAIMED');await p.apply();assert.equal(p.data.state,'PENDING');assert.equal(h.load('utils/family-state.ts').familyState(),null);assert.equal(h.calls.filter(c=>/\/subjects\/[^/]+$/.test(c.url)&&c.method==='POST').length,0);
});
test('cached cloud photos still require fresh server authorization on every open',async()=>{
 const h=harness(),state=h.load('utils/family-state.ts'),photos=h.load('utils/shared-meal-photo.ts');state.setFamilyState(shared);h.setHandler(async o=>o.url.endsWith('/photo')?{photo:{photoId:'id',expiresAt:new Date(Date.now()+100000).toISOString()}}:new Uint8Array([255,216,255]).buffer);
 const first=await photos.sharedMealPhoto('meal',shared.subjectId);assert(first);assert.equal(await photos.sharedMealPhoto('meal',shared.subjectId),first);assert.equal(h.calls.filter(c=>c.url.endsWith('/photo/id')).length,1);assert.equal(h.calls.filter(c=>c.url.endsWith('/photo')).length,2);
 h.setHandler(async()=>({http:403,data:{message:'撤权'}}));await assert.rejects(photos.sharedMealPhoto('meal',shared.subjectId),e=>e.statusCode===403);
});
test('VIEWER camera shortcuts are stopped before capture or record creation',()=>{
 const h=harness();h.load('utils/family-state.ts').setFamilyState({...shared,role:'VIEWER',canRecord:false});h.load('components/app-tabbar/app-tabbar.ts');const component=h.page();component.methods.open({currentTarget:{dataset:{key:'camera'}}});assert.equal(h.routes.length,0);h.load('pages/camera/camera.ts');h.page().onLoad({});assert.equal(h.routes.at(-1),'/pages/records/records');assert.equal(h.calls.length,0);
});
