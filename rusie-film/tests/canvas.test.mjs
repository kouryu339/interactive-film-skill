import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/shared/custom.js';
import '../assets/shared/catalog.js';
import '../assets/shared/canvas-protocol.js';
const { normalize } = globalThis.RusieCanvasProtocol;
const context = { story: { assets: [{ id:'clip',path:'assets/clip.mp4' }], catalog: [{id:'bg',kind:'background',path:'assets/bg.png',name:'BG'}] }, component:{files:['room.svg','video.webm']}, componentBase:'http://localhost/site/components/control/', source:path=>'/media/'+path+'?token=private' };

test('canvas commands resolve current component resources and registered assets without changing graph state', () => {
  const patch=normalize({operation:'set',layer:'background',patch:{source:'room.svg',style:{opacity:'.5'}}},context);
  assert.equal(patch.value.source,'http://localhost/site/components/control/room.svg'); assert.equal(patch.value.style.opacity,'.5');
  assert.equal(normalize({operation:'set',layer:'video',patch:{asset:'clip'}},context).value.source,'/media/assets/clip.mp4?token=private');
  assert.deepEqual(normalize({operation:'clear',layer:'video'},context),{operation:'clear',layer:'video'});
  assert.deepEqual(normalize({operation:'set',layer:'dialogue',patch:{text:'<script>plain</script>',speaker:'Actor'}},context).value.lines,[{name:'Actor',text:'<script>plain</script>'}]);
  assert.equal(context.story.nodes,undefined);
});

test('canvas commands reject other packages, host paths, graph fields and wrong asset kinds', () => {
  for (const patch of [{source:'../other/secret.png'},{source:'/api/project'},{source:'https://elsewhere/room.svg'},{source:'absent.svg'},{asset:'clip'},{source:'room.svg',asset:'bg'},{target:'another-node'},{style:{opacity:1}}]) assert.throws(()=>normalize({operation:'set',layer:'background',patch},context));
  assert.throws(()=>normalize({operation:'set',layer:'state',patch:{}},context));
  assert.throws(()=>normalize({operation:'clear',layer:'video',patch:{}},context));
  assert.throws(()=>normalize({operation:'set',layer:'dialogue',patch:{lines:[{text:5}]}},context));
});
