// Browser integration test: HTTP calls are intercepted with fixtures, not a live backend.
// Run against a separately started local admin build; set CHROMIUM_PATH if needed.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const BASE=process.env.ADMIN_BASE_URL || 'http://127.0.0.1:3000';
const tenant='11111111-1111-4111-8111-111111111111', appId='22222222-2222-4222-8222-222222222222', hookId='33333333-3333-4333-8333-333333333333';
const issuedKey='devkey_'+'a'.repeat(40), issuedSecret='devsec_'+'b'.repeat(64), webhookSecret='whsec_'+'c'.repeat(64), rotatedSecret='whsec_'+'d'.repeat(64);
const app={id:appId,name:'Real App',description:'',clientId:'client',state:'ACTIVE',environment:'SANDBOX',redirectUris:[],scopes:['profile:read','webhooks:manage'],homePageUrl:null,createdAt:'2026-01-01',updatedAt:'2026-01-01'};
const cred={id:'44444444-4444-4444-8444-444444444444',applicationId:appId,keyId:'devkey_fixture',label:'Existing Key',kind:'API_KEY',scopes:['profile:read'],expiresAt:null,revokedAt:null,createdAt:'2026-01-01'};
const hook={id:hookId,applicationId:appId,endpointUrl:'https://hooks.example.test/inbox',eventTypes:['order.filled'],eventVersion:'v1',environment:'SANDBOX',description:'',state:'ACTIVE',createdAt:'2026-01-01',updatedAt:'2026-01-01'};
const delivery={id:'55555555-5555-4555-8555-555555555555',eventId:'evt-1',eventType:'order.filled',attempt:1,state:'FAILED',outcomeClass:'NETWORK',responseStatus:null,nextRetryAt:null,correlationId:'c',createdAt:'2026-01-01',payload:{orderId:'[REDACTED]',status:'FILLED'}};
function token(perms,platform=false){return 'e30.'+Buffer.from(JSON.stringify({sub:'fixture',tid:tenant,roles:[],perms,plat:platform,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test'}
async function context(browser,perms,platform=false){const c=await browser.newContext();await c.addCookies([{name:'wlct_at',value:token(perms,platform),url:BASE},{name:'wlct_csrf',value:'fixture-csrf',url:BASE}]);return c;}
async function main(){
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),args:['--no-sandbox']});
 const ctx=await context(browser,['api_key:read','api_key:manage']); const page=await ctx.newPage();
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 let enabled=false, keyFailures=0, flagFailures=0, appFailures=0, pinFailures=0, pinnedVersion='v1', applications=[app], credentials=[cred], hooks=[hook], sent=[];
 const invalidProofs=new Set(['FEATURE_FLAG_LIVE_TOGGLE','DEVELOPER_APPLICATION_CREATE']);
 const fulfill=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({success:status<400,data})});
 await page.route('**/api/proxy/**',async route=>{
   const req=route.request(), u=new URL(req.url()), path=u.pathname.replace('/api/proxy',''), method=req.method();
   const data=req.postDataJSON();
   if(method!=='GET') sent.push({method,path,key:req.headers()['idempotency-key'],data});
   if(path==='/v1/feature-flags'&&method==='GET') return fulfill(route,[{key:'sample.flag',enabled,rolloutPercentage:100,metadata:{}}]);
   if(path==='/v1/feature-flags'&&method==='PUT') {if(flagFailures++===0)return route.abort('failed'); enabled=data.enabled;return fulfill(route,{key:data.key,enabled});}
   if(path==='/v1/auth/step-up/verify') { if(invalidProofs.delete(data.action)) return fulfill(route,{ok:true}); return fulfill(route,{proofId:'proof',action:data.action,method:data.method,expiresAt:new Date(Date.now()+60000).toISOString(),ttlSeconds:60}); }
   if(path==='/v1/developer-platform/applications'&&method==='GET') {
     if(u.searchParams.get('limit')==='100') return fulfill(route,u.searchParams.get('cursor') ? {rows:[{...app,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Far App'}],nextCursor:null} : {rows:applications,nextCursor:'app-page-1'});
     return fulfill(route,{rows:applications,nextCursor:null});
   }
   if(path==='/v1/developer-platform/api-versions') return fulfill(route,{versions:[{version:'v1',state:'DEPRECATED',deprecatedAt:'2026-09-24',sunsetAt:'2027-09-24',replacement:'v2'},{version:'v2',state:'SUPPORTED'}]});
   if(path===`/v1/developer-platform/applications/${appId}/api-version`&&method==='GET')return fulfill(route,{applicationId:appId,version:pinnedVersion});
   if(path===`/v1/developer-platform/applications/${appId}/api-version`&&method==='PUT'){if(pinFailures++===0)return route.abort('failed');pinnedVersion=data.version;return fulfill(route,{applicationId:appId,version:pinnedVersion});}
   if(path.startsWith('/v1/developer-platform/applications/')&&method==='GET') return fulfill(route,applications.find(a=>path.endsWith(a.id)));
   if(path==='/v1/developer-platform/audit'&&method==='GET') return fulfill(route,{rows:[{id:'audit-1',action:'application.created',actorType:'USER',actorId:'operator',createdAt:'2026-01-01T00:00:00Z',detail:{token:'never-display-this'}}],nextCursor:null});
   if(path==='/v1/developer-platform/scope-catalog') return fulfill(route,{scopes:[{scope:'profile:read',category:'profile',write:false},{scope:'webhooks:manage',category:'webhooks',write:true}]});
   if(path==='/v1/developer-platform/applications'&&method==='POST') {if(appFailures++===0)return route.abort('failed'); const created={...app,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:data.name,description:data.description,redirectUris:data.redirectUris,scopes:data.requestedScopes,state:'PENDING'};applications=[...applications,created];return fulfill(route,created,201);}
   if(path==='/v1/developer-platform/applications/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/activate'&&method==='POST') {applications=applications.map(a=>a.id.startsWith('aaaaaaaa')?{...a,state:'ACTIVE'}:a);return fulfill(route,{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',state:'ACTIVE'});}
   if(path==='/v1/developer-platform/applications/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/scopes'&&method==='PUT') {applications=applications.map(a=>a.id.startsWith('aaaaaaaa')?{...a,scopes:data.scopes}:a);return fulfill(route,applications.at(-1));}
   if(path==='/v1/developer-platform/usage') return fulfill(route,{totalRequests:8,totalRateLimited:0,totalWebhookDeliveries:0,totalWebhookFailures:0,byEndpoint:[{endpoint:'profile.read',requests:8,errors4xx:1,errors5xx:0}],byApiVersion:[],periodId:'2026-01-01',sources:[]});
   if(path==='/v1/developer-platform/analytics') return fulfill(route,{webhookFailures:3,activeApiKeys:13});
   if(path==='/v1/developer-platform/credentials'&&method==='GET') return fulfill(route,u.searchParams.get('cursor') ? {rows:[{...cred,id:'88888888-8888-4888-8888-888888888888',keyId:'devkey_second',label:'Page Two Key'}],nextCursor:null} : {rows:credentials,nextCursor:'key-page-1'});
   if(path===`/v1/developer-platform/applications/${appId}/credentials`&&method==='POST') {if(keyFailures++===0)return route.abort('failed');const next={...cred,id:'66666666-6666-4666-8666-666666666666',keyId:issuedKey,label:data.label}; credentials=[...credentials,next];return fulfill(route,{keyId:next.keyId,secret:issuedSecret,scopes:next.scopes,expiresAt:null},201);}
   if(path===`/v1/developer-platform/applications/${appId}/credentials/devkey_fixture`&&method==='DELETE') {credentials=credentials.map(c=>c.keyId==='devkey_fixture'?{...c,revokedAt:'2026-01-01'}:c);return route.fulfill({status:204});}
   if(path==='/v1/developer-platform/event-types')return fulfill(route,{eventTypes:[{eventType:'order.filled',resourceType:'order',eventVersion:'v1',source:'execution',schemaId:'order.filled.v1'}]});
   if(path==='/v1/developer-platform/webhooks'&&method==='GET')return fulfill(route,u.searchParams.get('cursor') ? {rows:[{...hook,id:'99999999-9999-4999-8999-999999999999',endpointUrl:'https://page-two.example.test/inbox'}],nextCursor:null} : {rows:hooks,nextCursor:'hook-page-1'});
   if(path==='/v1/developer-platform/webhooks'&&method==='POST'){hooks=[...hooks,{...hook,id:'77777777-7777-4777-8777-777777777777',applicationId:data.applicationId,endpointUrl:data.endpointUrl,eventTypes:data.eventTypes,description:data.description}];return fulfill(route,{subscription:hooks.at(-1),secret:webhookSecret},201);}
   if(path===`/v1/developer-platform/webhooks/${hookId}/rotate-secret`) return fulfill(route,{secret:rotatedSecret});
   if(path===`/v1/developer-platform/webhooks/${hookId}/pause`) {hooks=hooks.map(x=>x.id===hookId?{...x,state:'PAUSED'}:x);return fulfill(route,hooks[0]);}
   if(path===`/v1/developer-platform/webhooks/${hookId}/deliveries`)return fulfill(route,{rows:[delivery],nextCursor:null});
   if(path===`/v1/developer-platform/webhooks/${hookId}/replay`)return fulfill(route,{deliveryId:'replay-1',eventId:data.eventId},202);
   throw new Error(`Unexpected fixture ${method} ${path}`);
 });
 async function verify(method='TOTP'){
   const d=page.getByRole('dialog'); await d.waitFor();
   if(method!=='TOTP') await d.getByLabel('Verification method').selectOption(method);
   await d.locator('input').fill(method==='TOTP'?'123456':'recovery-value');
   await d.getByRole('button',{name:'Verify and continue'}).click();
 }
 await page.goto(BASE+'/feature-flags'); await page.getByText('sample.flag').waitFor();
 await page.getByLabel('Change reason').fill('Test change reason');
 await page.getByRole('button',{name:'Disabled — turn on'}).click(); await verify('RECOVERY_CODE');
 await page.getByRole('dialog').getByRole('alert').filter({hasText:'Verification failed'}).waitFor();
 assert.equal(sent.filter(x=>x.path==='/v1/feature-flags').length,0);
 await verify('RECOVERY_CODE');
 await page.getByRole('alert').filter({hasText:'could not be confirmed'}).waitFor();
 await page.getByRole('button',{name:'Disabled — turn on'}).click(); await verify('RECOVERY_CODE');
 await page.getByText('The feature flag was updated.').waitFor();
 const flags=sent.filter(x=>x.path==='/v1/feature-flags'); assert.equal(flags.length,2);assert.equal(flags[0].key,flags[1].key);
 assert.equal(flags[1].data.metadata.reason,'Test change reason');
 const proofs=sent.filter(x=>x.path==='/v1/auth/step-up/verify'); assert(proofs.slice(0,2).every(x=>x.data.action==='FEATURE_FLAG_LIVE_TOGGLE'&&x.data.method==='RECOVERY_CODE'));
 for(const [locale,title] of [['bn','টেন্যান্ট ফিচার ফ্ল্যাগ'],['ar','ميزات المستأجر'],['es','Funciones del inquilino'],['tr','Kiracı özellik bayrakları'],['en','Tenant feature flags']]){
   await page.locator('section').filter({has:page.locator('#tenant-feature-flags-title')}).locator('select').first().selectOption(locale);
   assert.equal(await page.locator('#tenant-feature-flags-title').innerText(),title);
   assert.equal(await page.locator('#tenant-feature-flags-title').evaluate(el=>el.closest('[lang]').dir),locale==='ar'?'rtl':'ltr');
 }
 await page.goto(BASE+'/developer/applications'); await page.getByText('Real App').waitFor();
 for(const [locale,title] of [['bn','অ্যাপ্লিকেশন'],['ar','التطبيقات'],['es','Aplicaciones'],['tr','Uygulamalar'],['en','Applications']]){
   await page.locator('nav select').selectOption(locale);
   assert.equal(await page.locator('#applications-title').innerText(),title);
 }
 await page.getByLabel('Application name').fill('Second App');
 await page.getByLabel('Redirect URIs, one per line').fill('https://client.example.test/callback');
 await page.getByLabel('Scopes').selectOption(['profile:read','webhooks:manage']);
 await page.getByRole('button',{name:'Create',exact:true}).click();await verify();
 await page.getByRole('dialog').getByRole('alert').filter({hasText:'Verification failed'}).waitFor();
 assert.equal(sent.filter(x=>x.path==='/v1/developer-platform/applications'&&x.method==='POST').length,0);
 await verify();
 await page.getByRole('alert').filter({hasText:'could not be confirmed'}).waitFor();
 await page.getByRole('button',{name:'Create',exact:true}).click();await verify();
 await page.getByText('The application registration was confirmed.').waitFor();
 const appCreates=sent.filter(x=>x.path==='/v1/developer-platform/applications'&&x.method==='POST');
 assert.equal(appCreates.length,2);assert.equal(appCreates[0].key,appCreates[1].key);
 await page.getByRole('row',{name:/Second App/}).getByRole('button',{name:'Activate'}).click();await verify();
 await page.getByText('The application state was updated.').waitFor();
 await page.getByRole('row',{name:/Second App/}).getByRole('button',{name:'Edit scopes'}).click();
 await page.getByLabel('Scopes').selectOption(['profile:read']);
 await page.getByRole('button',{name:'Save',exact:true}).click();await verify();
 await page.getByText('The application was updated.').waitFor();
 assert(sent.some(x=>x.path==='/v1/auth/step-up/verify'&&x.data.action==='DEVELOPER_APPLICATION_SCOPE_CHANGE'));
 await page.getByRole('row',{name:/Second App/}).getByRole('button',{name:'Details'}).click();
 await page.getByRole('heading',{name:'Details: Second App'}).waitFor();await page.getByText('https://client.example.test/callback').waitFor();
 await page.goto(BASE+'/developer/audit');await page.getByText('application.created').waitFor();
 assert.equal(await page.getByText('never-display-this').count(),0);
 await page.goto(BASE+'/developer/reconciliation');await page.getByText('Platform access is required for reconciliation.').waitFor();

 await page.goto(BASE+'/developer'); await page.getByText('profile.read').waitFor();
 await page.getByRole('navigation',{name:'Application pages'}).getByRole('button',{name:'Next'}).click();
 await page.getByRole('option',{name:/Far App/}).waitFor({state:'attached'});
 await page.getByRole('navigation',{name:'Application pages'}).getByRole('button',{name:'Previous'}).click();
 await page.getByRole('option',{name:/Real App/}).waitFor({state:'attached'});
 assert.equal(await page.locator('.dev-card').filter({hasText:'Webhook failures'}).getByRole('heading').innerText(),'3');
 assert.equal(await page.locator('.dev-card').filter({hasText:'Active API keys'}).getByRole('heading').innerText(),'13');
 await page.goto(BASE+'/developer/versions'); await page.getByText('X-Api-Version: v1').waitFor();
 await page.getByLabel('Pinned API version').selectOption('v2'); await page.getByRole('button',{name:'Pin version'}).click(); await verify();
 await page.getByRole('alert').filter({hasText:'could not be confirmed'}).waitFor();
 await page.getByLabel('Pinned API version').selectOption('v2'); await page.getByRole('button',{name:'Pin version'}).click(); await verify();
 await page.getByText('The version pin was updated.').waitFor(); await page.getByText('X-Api-Version: v2').waitFor();
 const pinWrites=sent.filter(x=>x.path===`/v1/developer-platform/applications/${appId}/api-version`&&x.method==='PUT');
 assert.equal(pinWrites.length,2);assert.equal(pinWrites[0].key,pinWrites[1].key);assert(pinWrites[1].key);
 assert(sent.some(x=>x.path==='/v1/auth/step-up/verify'&&x.data.action==='DEVELOPER_APPLICATION_VERSION_PIN'));
 await page.goto(BASE+'/developer/api-keys'); await page.getByText('Existing Key').waitFor();
 await page.getByRole('navigation',{name:'Application pages'}).getByRole('button',{name:'Next'}).click();
 await page.getByRole('option',{name:/Far App/}).waitFor({state:'attached'});
 await page.getByRole('navigation',{name:'Application pages'}).getByRole('button',{name:'Previous'}).click();
 await page.getByRole('option',{name:/Real App/}).waitFor({state:'attached'});
 await page.locator('.dev-card').filter({has:page.locator('table')}).getByRole('button',{name:'Next'}).click(); await page.getByText('Page Two Key').waitFor();
 await page.locator('.dev-card').filter({has:page.locator('table')}).getByRole('button',{name:'Previous'}).click(); await page.getByText('Existing Key').waitFor();
 await page.getByLabel('Label',{exact:true}).fill('New Key'); await page.getByRole('button',{name:'Create',exact:true}).click();await verify();
 await page.getByRole('alert').filter({hasText:'could not be confirmed'}).waitFor();
 await page.getByRole('button',{name:'Create',exact:true}).click();await verify();
 await page.getByText(issuedSecret).waitFor();
 const creates=sent.filter(x=>x.path===`/v1/developer-platform/applications/${appId}/credentials`);assert.equal(creates.length,2);assert.equal(creates[0].key,creates[1].key);
 await page.getByRole('button',{name:'I have saved the secret'}).click();assert.equal(await page.getByText(issuedSecret).count(),0);
 await page.getByRole('row',{name:/Existing Key/}).getByRole('button',{name:'Revoke'}).click();await verify();await page.getByText('The key was revoked.').waitFor();
 assert(sent.some(x=>x.path==='/v1/auth/step-up/verify'&&x.data.action==='API_KEY_REVOKE'));
 await page.goto(BASE+'/developer/webhooks');await page.getByText('https://hooks.example.test/inbox').waitFor();
 await page.getByRole('navigation',{name:'Application pages'}).getByRole('button',{name:'Next'}).click();
 await page.getByRole('option',{name:/Far App/}).waitFor({state:'attached'});
 await page.getByRole('navigation',{name:'Application pages'}).getByRole('button',{name:'Previous'}).click();
 await page.getByRole('option',{name:/Real App/}).waitFor({state:'attached'});
 await page.locator('.dev-card').filter({has:page.locator('table')}).getByRole('button',{name:'Next'}).click(); await page.getByText('https://page-two.example.test/inbox').waitFor();
 await page.locator('.dev-card').filter({has:page.locator('table')}).getByRole('button',{name:'Previous'}).click(); await page.getByText('https://hooks.example.test/inbox').waitFor();
 await page.getByLabel('HTTPS endpoint URL').fill('https://hooks.example.test:8443/inbox');await page.getByLabel('Event subscriptions').selectOption('order.filled');
 await page.getByRole('button',{name:'Create',exact:true}).click(); await page.getByRole('alert').filter({hasText:'port 443'}).waitFor();
 await page.getByLabel('HTTPS endpoint URL').fill('https://new-hook.example.test/inbox');await page.getByRole('button',{name:'Create',exact:true}).click();await verify();
 await page.getByText(webhookSecret).waitFor();await page.getByRole('button',{name:'I have saved the secret'}).click();
 await page.getByRole('row',{name:/hooks.example.test\/inbox/}).first().getByRole('button',{name:'Rotate signing secret'}).click();await verify();
 await page.getByText(rotatedSecret).waitFor();await page.getByRole('button',{name:'I have saved the secret'}).click();
 await page.getByRole('row',{name:/hooks.example.test\/inbox/}).first().getByRole('button',{name:'Pause'}).click();await verify();
 await page.getByText('The webhook was updated.').waitFor();
 await page.goto(BASE+`/developer/webhooks/${hookId}/deliveries`);await page.getByText('evt-1').waitFor();
 await page.getByRole('button',{name:'Replay',exact:true}).click();await verify();await page.getByText(/Replay accepted/).waitFor();
 assert(sent.some(x=>x.path.endsWith('/replay')&&x.key&&x.data.eventId==='evt-1'));
 assert.equal(errors.length,0,errors.join('\n'));
 const platform=await context(browser,['api_key:read','api_key:manage'],true);const platformPage=await platform.newPage();
 await platformPage.route('**/api/proxy/v1/developer-platform/reconciliation*',r=>fulfill(r,{tenantId:tenant,scannedAt:'2026-01-01T00:00:00Z',truncated:true,findings:[{kind:'WEBHOOK_SCOPE_MISMATCH',severity:'MEDIUM',subjectType:'developer_webhook_subscription',subjectId:hookId,detail:'not-rendered',suggestedAction:'not-rendered'}]}));
 await platformPage.goto(BASE+'/developer/reconciliation');await platformPage.getByRole('button',{name:'Run report'}).click();
 await platformPage.getByText('WEBHOOK_SCOPE_MISMATCH').waitFor();await platformPage.getByRole('alert').filter({hasText:'incomplete'}).waitFor();
 const deniedContext=await context(browser,[]);const denied=await deniedContext.newPage();await denied.goto(BASE+'/developer/api-keys');
 await denied.getByText('Developer data requires API key read permission.').waitFor();
 assert.equal(await denied.getByRole('heading',{name:'Create API key'}).count(),0);
 process.stdout.write('PASS: flags proof + recovery code + retry key; five locales/RTL; application creation/activation/scope change/details; audit redaction; reconciliation access/truncation; key create, one-time secret, revoke; webhook validation/create/rotation/pause/replay; cursor pagination for application selectors, keys and webhooks; overview uses analytics; persisted version pin with proof/retry; permission-gated UI.\n');
 await browser.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
