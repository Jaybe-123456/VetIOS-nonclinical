import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
import { HEADERS } from './policy.mjs';
import assert from 'node:assert/strict';
export async function browserCheck(directory,artifact,output) {
    const server=await startServer(directory,artifact);let browser;
    const checks=[],captures=[],requests=[],errors=[],violations=[];
    try {
        browser=await chromium.launch({headless:true});
        for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
            const context=await browser.newContext({viewport});
            await context.exposeBinding('reportViolation',(_source,event)=>violations.push(event));
            await context.addInitScript(()=>document.addEventListener('securitypolicyviolation',event=>window.reportViolation({directive:event.violatedDirective,blocked:event.blockedURI})));
            context.on('request',request=>requests.push({url:request.url(),method:request.method()}));
            const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
            for(const route of ['/','/docs/','/demo/','/boundary/']){
                const response=await page.goto(server.url+route);assert.equal(response.status(),200);
                for(const [header,value]of Object.entries(HEADERS))assert.equal(response.headers()[header],value);
                assert.equal(await page.locator('input,textarea,select,form,iframe').count(),0);
                assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
                if(route==='/demo/'){
                    await page.getByRole('button',{name:'2 · Contradiction',exact:true}).click();
                    await page.getByText('CONTRADICTION RECORDED',{exact:true}).waitFor();
                    assert.match(await page.locator('[data-value="verification"]').textContent(),/Abstain/);
                    await page.getByRole('button',{name:'3 · Follow-up linked',exact:true}).click();
                    assert.match(await page.locator('[data-json]').textContent(),/"patient_data": false/);
                    assert.equal(await page.locator('[data-value="learning"]').textContent(),'Disabled');
                    assert.equal(await page.getByRole('button',{name:'3 · Follow-up linked',exact:true}).getAttribute('aria-pressed'),'true');
                    checks.push(name+':fixed_local_trace_and_abstention');
                }
                if(route==='/boundary/'){
                    for(const text of ['NOT_ESTABLISHED','INCOMPLETE','BLOCKED'])assert.ok(await page.getByText(text,{exact:true}).count()>0);
                    assert.match(await page.locator('[data-public-operator]').textContent(),/not authorized for publication/);
                    assert.ok(await page.getByRole('heading',{name:'Hosting and request metadata',exact:true}).isVisible());
                    assert.match(await page.locator('.prose').textContent(),/global edge network/);
                    assert.match(await page.locator('.prose').textContent(),/no universal deletion period/);
                    assert.match(await page.locator('.prose').textContent(),/email provider/);
                    checks.push(name+':visible_privacy_scope_and_unresolved_owner');
                }
                const file=`${name}-${route==='/'?'home':route.split('/')[1]}.png`;
                await page.screenshot({path:path.join(output,file),fullPage:true});captures.push(file);checks.push(name+':'+route);
            }
            await page.goto(server.url+'/demo/');await page.keyboard.press('Tab');
            assert.notEqual(await page.evaluate(()=>document.activeElement?.tagName),'BODY');checks.push(name+':keyboard_access');
            assert.equal((await context.cookies()).length,0);
            assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);checks.push(name+':no_browser_persistence');
            const denied=await context.request.post(server.url+'/api/inference',{data:{tenant_id:'foreign',patient:'AUTHORED_FIXTURE'}});assert.equal(denied.status(),403);checks.push(name+':clinical_post_denied');
            await context.close();
        }
        assert.equal(errors.length,0);assert.equal(violations.length,0);
        assert.ok(requests.every(r=>new URL(r.url).origin===server.url&&['GET','HEAD'].includes(r.method)));
        checks.push('no_external_browser_requests','no_page_errors','no_csp_violations');
        const result={status:'PASS',fixture_only:true,clinical_validation:false,checks,captures,request_count:requests.length,
            external_requests:0,page_errors:errors,csp_violations:violations,production_actions:0};
        await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return result;
    } finally {await browser?.close();await server.close();}
}
