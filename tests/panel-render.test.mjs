import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { renderPanel } from "../scripts/panel-render.mjs";
function setup(){const {document}=parseHTML("<html><body><div id=panel></div></body></html>");globalThis.document=document;return document.getElementById("panel");}

test("clock updates keep route controls, status buttons and their listeners attached", () => {
  const root=setup(),html=n=>`<header>Travel</header><div class="body"><button data-act="leg-fold" data-g="0">Destination</button></div><div class="tr-pin"><span>${n} miles</span><button data-act="stop">Pause travel</button></div>`;
  renderPanel(root,html(1));
  const route=root.querySelector('.body'),button=root.querySelector('[data-act="stop"]');let clicked=0;
  button.addEventListener('click',()=>clicked++);
  const grip=document.createElement('div');grip.className='kgr-grip';root.append(grip);
  renderPanel(root,html(2));
  assert.equal(root.querySelector('.body'),route);assert.equal(root.querySelector('[data-act="stop"]'),button);
  assert.equal(root.querySelector('.kgr-grip'),grip);assert.ok(button.isConnected);button.click();assert.equal(clicked,1);
  assert.equal(root.querySelector('.tr-pin span').textContent,'2 miles');
});

test("changed actions are replaced and inserted sections do not duplicate controls", () => {
  const root=setup();renderPanel(root,'<header>Travel</header><nav>Route</nav><div class="body"><button data-act="stop">Pause</button></div>');
  const old=root.querySelector('button');
  renderPanel(root,'<header>Travel</header><nav>Parties</nav><nav>Route</nav><div class="body"><button data-act="resume">Resume</button></div>');
  assert.equal(root.querySelectorAll('button').length,1);assert.equal(old.isConnected,false);
  assert.equal(root.querySelectorAll('nav').length,2);assert.equal(root.querySelector('button').dataset.act,'resume');
  renderPanel(root,'<header>Travel</header>');assert.equal(root.children.length,1);
});

test("form controls reflect programmatic changes while their nodes are retained", () => {
  const root=setup(),html=(n,selected)=>`<input name="hours" value="${n}"><select name="boat"><option value="a" ${selected==='a'?'selected':''}>A</option><option value="b" ${selected==='b'?'selected':''}>B</option></select>`;
  renderPanel(root,html(2,'a'));const input=root.querySelector('input'),select=root.querySelector('select');
  renderPanel(root,html(4,'b'));assert.equal(root.querySelector('input'),input);assert.equal(input.value,'4');assert.equal(root.querySelector('select'),select);assert.equal(select.value,'b');
});
