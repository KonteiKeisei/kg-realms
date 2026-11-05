import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {WINDOW_THEMES,registerWindowAppearance,applyWindowTheme,applyGlassOpacity,applyGlassBlur,dialogAppearance,RealmDialog} from '../scripts/ui-theme.mjs';

const setup=()=>{globalThis.document=parseHTML('<html><body class="other-module"></body></html>').document;};

test('appearance defaults are client-only and preserve a saved theme choice',()=>{
  setup();const definitions=new Map(),stored=new Map([['windowTheme','amethyst']]);
  globalThis.game={settings:{get:(_id,key)=>stored.has(key)?stored.get(key):definitions.get(key).default}};
  registerWindowAppearance((key,definition)=>definitions.set(key,definition));
  assert.equal(definitions.get('windowTheme').default,'slate');
  assert.equal(Object.keys(WINDOW_THEMES).length,8);
  assert.ok([...definitions.values()].every(d=>d.scope==='client'));
  assert.ok(document.body.classList.contains('kgr-theme-amethyst'));
  assert.ok(document.body.classList.contains('other-module'));
  assert.equal(document.body.style.getPropertyValue('--kgr-glass-opacity'),'75%');
  assert.equal(document.body.style.getPropertyValue('--kgr-glass-blur'),'8px');
});

test('changing appearance removes stale theme classes without changing unrelated body classes',()=>{
  setup();applyWindowTheme('royal');applyWindowTheme('holy');
  assert.equal(document.body.classList.contains('kgr-theme-royal'),false);
  assert.equal(document.body.classList.contains('kgr-theme-holy'),true);
  applyWindowTheme('obsolete');
  assert.equal(document.body.classList.contains('kgr-theme-slate'),true);
  assert.equal(document.body.classList.contains('kgr-theme-holy'),false);
  assert.equal(document.body.classList.contains('other-module'),true);
});

test('glass controls stay bounded, permit no blur, and recover from invalid settings',()=>{
  setup();applyGlassOpacity(500);assert.equal(document.body.style.getPropertyValue('--kgr-glass-opacity'),'100%');
  applyGlassOpacity(-1);assert.equal(document.body.style.getPropertyValue('--kgr-glass-opacity'),'20%');
  applyGlassOpacity('invalid');assert.equal(document.body.style.getPropertyValue('--kgr-glass-opacity'),'75%');
  applyGlassBlur(0);assert.equal(document.body.style.getPropertyValue('--kgr-glass-blur'),'0px');
  applyGlassBlur(90);assert.equal(document.body.style.getPropertyValue('--kgr-glass-blur'),'18px');
  applyGlassBlur(undefined);assert.equal(document.body.style.getPropertyValue('--kgr-glass-blur'),'8px');
});

test('dialog styling preserves existing classes and callback identities without mutating the caller',()=>{
  const callback=()=>42,buttons=[{action:'save',callback}],render=()=>{};
  const options={classes:['module-specific','kgr-ui'],buttons,render,rejectClose:false,window:{title:'Edit road'}};
  const result=dialogAppearance(options);
  assert.notEqual(result,options);assert.deepEqual(result.classes,['module-specific','kgr-ui']);
  assert.equal(result.buttons,buttons);assert.equal(result.render,render);assert.equal(result.buttons[0].callback(),42);
  assert.equal(result.window,options.window);assert.equal(result.rejectClose,false);
  assert.deepEqual(options.classes,['module-specific','kgr-ui']);
  assert.deepEqual(dialogAppearance({}).classes,['kgr-ui']);
});

test('themed native dialogs retain their receiver, arguments, promise results and cancellation behavior',async()=>{
  const calls=[],pending=Promise.resolve('selected');
  const native={wait(options,extra){assert.equal(this,native);calls.push([options,extra]);return pending;},confirm(options){calls.push([options]);return Promise.resolve(false);},prompt(options){calls.push([options]);return Promise.resolve(null);}};
  globalThis.foundry={applications:{api:{DialogV2:native}}};
  assert.equal(RealmDialog.wait({content:'<p>Original content</p>'},'render options'),pending);
  assert.equal(await pending,'selected');assert.equal(calls[0][1],'render options');
  assert.equal(calls[0][0].content,'<p>Original content</p>');assert.deepEqual(calls[0][0].classes,['kgr-ui']);
  assert.equal(await RealmDialog.confirm({}),false);assert.equal(await RealmDialog.prompt({}),null);
});
