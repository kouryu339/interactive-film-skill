import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { bundle, initialize, readProject, saveProject, exportProject } from '../scripts/project.mjs';
import { startServer } from '../scripts/server.mjs';
import { serveExport } from '../assets/serve.mjs';
import { launchBrowser } from './browser-driver.mjs';
const output = path.join(bundle, '.test-output'); await fs.mkdir(output, { recursive: true });
const temporary = await fs.mkdtemp(path.join(output, 'canvas-browser-')), root = await initialize(path.join(temporary, 'project'));
const loaded = await readProject(root), story = loaded.story;
story.format = 'rusie.film/2'; story.start = 'a'; story.assets = [];
for (const [name, file] of [['a','sample-1.mp4'],['b','sample-2.mp4'],['c','sample-3.mp4']]) {
  await fs.copyFile(path.join(bundle, 'tests/fixtures/film/assets', file), path.join(root, 'assets', `clip-${name}.mp4`));
  story.assets.push({ id: name, label: name, path: `assets/clip-${name}.mp4` });
}
await fs.writeFile(path.join(root,'assets/bg.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64'));
story.catalog = [{ id:'bg', kind:'background', name:'Explicit scene cut', path:'assets/bg.png' }];
story.nodes = [
 { id:'a', title:'A', text:'', video:'a', ending:false, choices:[{id:'next',label:'B',target:'b'}] },
 { id:'b', title:'B', text:'', video:'b', ending:false, choices:[{id:'next',label:'D',target:'d'}] },
 { id:'d', title:'D', text:'', video:null, ending:false, choices:[{id:'next',label:'C',target:'c'}] },
 { id:'c', title:'C', text:'', video:'c', presentation:{background:'bg'}, ending:true, choices:[] }
];
await saveProject(root,story,loaded.revision); const editor=await startServer(root); let browser,hosted; const checks=[];
try {
  browser=await launchBrowser(temporary); const {evaluate:run,waitFor:wait}=browser;
  let paused=[]; browser.on('Fetch.requestPaused',event=>paused.push(event));
  await browser.send('Fetch.enable',{patterns:[{urlPattern:'*assets/clip-b.mp4*'},{urlPattern:'*assets/clip-c.mp4*'}]});
  async function exercise(url,label) {
    paused=[]; await browser.navigate(url); await wait(`!!document.querySelector('video')`,'video created');
    await run(`if(!document.getElementById('media-gate').hidden)document.getElementById('resume').click()`);
    await wait(`!!document.querySelector('[data-canvas-video="tail"]')&&document.querySelectorAll('#choices button').length===1`,'A tail and choice',undefined,15000);
    const tail=await run(`(()=>{const video=document.querySelector('[data-canvas-video="tail"]');window.savedTail=video;return {width:video.videoWidth,ended:video.ended,time:video.currentTime,visible:getComputedStyle(video).opacity,position:getComputedStyle(video).position}})()`);
    assert.ok(tail.width>0&&tail.ended&&tail.time>0); assert.equal(tail.visible,'1'); assert.equal(tail.position,'absolute');
    await run(`document.querySelector('#choices button').click()`); await wait(`document.getElementById('node-title').textContent==='B'`,'enter B');
    await wait(`document.querySelectorAll('video').length===2`,'two-video handoff');
    assert.equal(await run(`savedTail.isConnected&&savedTail.ended&&savedTail.dataset.canvasVideo==='tail'`),true);
    assert.equal(await run(`document.querySelector('[data-canvas-video="pending"]').style.opacity`),'0');
    const deadline=Date.now()+10000; while(!paused.some(event=>event.request.url.includes('clip-b.mp4'))&&Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50));
    const request=paused.find(event=>event.request.url.includes('clip-b.mp4')); assert.ok(request);
    await browser.send('Fetch.fulfillRequest',{requestId:request.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'video/mp4'}],body:(await fs.readFile(path.join(root,'assets/clip-b.mp4'))).toString('base64')});
    await wait(`!savedTail.isConnected&&document.querySelector('video')?.videoWidth>0&&document.querySelector('video').style.opacity==='1'`,'first B frame replaces A',undefined,15000);
    assert.equal(await run(`document.querySelectorAll('video').length`),1);
    checks.push(label+': A tail stays through choice and stalled B load, then B first frame atomically replaces it');
    await wait(`!!document.querySelector('[data-canvas-video="tail"]')&&!!document.querySelector('#choices button')`,'B tail',undefined,15000);
    await run(`window.savedTail=document.querySelector('video');document.querySelector('#choices button').click()`);
    await wait(`document.getElementById('node-title').textContent==='D'`,'control-only node');
    assert.equal(await run(`savedTail.isConnected&&savedTail.dataset.canvasVideo==='tail'&&document.querySelectorAll('video').length===1`),true);
    await run(`document.querySelector('#choices button').click()`); await wait(`document.getElementById('node-title').textContent==='C'`,'background cut node');
    assert.equal(await run(`savedTail.isConnected`),false);
    await wait(`document.querySelector('.scene-background')?.naturalWidth===1`,'new background visible');
    assert.equal(await run(`document.querySelectorAll('[data-canvas-video="tail"]').length`),0);
    assert.equal(await run(`document.querySelector('[data-canvas-video="pending"]').style.opacity`),'0');
    const end=Date.now()+10000; while(!paused.some(event=>event.request.url.includes('clip-c.mp4'))&&Date.now()<end) await new Promise(resolve=>setTimeout(resolve,50));
    const cut=paused.find(event=>event.request.url.includes('clip-c.mp4')); assert.ok(cut);
    await browser.send('Fetch.fulfillRequest',{requestId:cut.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'video/mp4'}],body:(await fs.readFile(path.join(root,'assets/clip-c.mp4'))).toString('base64')});
    await wait(`!!document.querySelector('[data-canvas-video="tail"]')&&document.getElementById('eyebrow').textContent.startsWith('THE END')`,'C own tail retained',undefined,15000);
    assert.equal(await run(`document.querySelector('video').hidden`),false);
    checks.push(label+': no-video node inherits B tail; explicit background cuts B at entry even with C pre-video; C retains its own tail');
  }
  await exercise(editor.origin+'/player.html?preview=1#token='+editor.token,'Preview');
  const exported=await exportProject(root,path.join(temporary,'exported')); hosted=await serveExport(exported.output,0); await exercise(hosted.url,'Export');
  const renderOverride=await run(`(()=>{
    const screen=document.createElement('section'),picture=document.createElement('div');screen.append(picture);document.body.append(screen);let cleaned=0,completed=0,paused=0,resumed=0;
    const canvas=RusieCanvas.create({picture,screen});
    canvas.override('portrait',({root,value})=>{const element=document.createElement('b');element.textContent=value.alt;root.append(element);return{dispose(){cleaned++;element.remove()},pause(){paused++},resume(){resumed++}}});
    canvas.override('dialogue',({root,value,done})=>{root.textContent=value.lines[0].text;done()});
    canvas.set('portrait',{source:'custom',alt:'Inherited portrait'});const portrait=screen.querySelector('b').textContent;
    canvas.set('dialogue',{lines:[{name:'Actor',text:'Custom dialogue'}]},{onDone(){completed++}});
    canvas.pause();canvas.resume();canvas.clear('portrait');canvas.dispose();screen.remove();return{portrait,cleaned,completed,paused,resumed};
  })()`);
  assert.deepEqual(renderOverride,{portrait:'Inherited portrait',cleaned:1,completed:1,paused:1,resumed:1});
  await run(`window.lastC=document.querySelector('[data-canvas-video="tail"]');window.confirm=()=>true;document.getElementById('restart').click()`);
  await wait(`document.getElementById('node-title').textContent==='A'`,'restart graph');
  assert.equal(await run(`lastC.isConnected`),false); assert.equal(await run(`document.querySelectorAll('.scene-background').length`),0);
  checks.push('host layer renderer overrides receive lifecycle cleanup; graph restart explicitly clears old tail and background');
  assert.deepEqual(browser.exceptions,[]); checks.push('no uncaught browser exceptions');
  const report={passed:true,checks}; await fs.writeFile(path.join(output,'canvas-browser-validation.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
} finally { await browser?.close(); await hosted?.close(); await editor.close(); const resolved=await fs.realpath(temporary); assert.equal(path.dirname(resolved),await fs.realpath(output)); assert.ok(path.basename(resolved).startsWith('canvas-browser-')); await fs.rm(resolved,{recursive:true,force:true,maxRetries:3}); }
