const ID = 'kg-realms', SETTING = 'integrationSetup';
export const INTEGRATIONS = [
  {id:'calendaria',name:'Calendaria',recommended:true,use:'Travel, watches, camp timekeeping, calendars and seasons.'},
  {id:'rest-recovery',name:'Rest Recovery',use:'Character recovery after camp.'},
  {id:'fxmaster',name:'FXMaster',use:'Scene effects.'},
  {id:'fxmaster-plus',name:'FXMaster+',use:'Water and local-map effects.'},
  {id:'tenacity',name:'Tenacity',use:'Spends on requested checks.'},
  {id:'flash-rolls-5e',name:'Flash Token Bar 5e',use:'Encounter Perception roll requests.'},
  {id:'vgmusic',name:'Video Game Music',use:'Scene and combat music.'}
];
const rows = value => Array.from(value?.values?.() ?? value ?? []);
const permitted = game => !!(game.user?.isGM && (game.user.can?.('SETTINGS_MODIFY') ?? true));
const enabled = (module, config) => Object.hasOwn(config,module.id) ? config[module.id] === true : !!module.active;
const configuration = game => ({...(game.settings.get('core','moduleConfiguration') ?? {})});
const newer = (a,b) => !!globalThis.foundry?.utils?.isNewerVersion?.(a,b);
const outside = (version, range) => !!(range?.minimum && newer(range.minimum,version) || range?.maximum && newer(version,range.maximum));
// A core maximum of "14" covers the entire V14 generation, including build-qualified versions.
const outsideFoundry = (version,range) => {
  const max=String(range?.maximum??'');
  return !!(range?.minimum&&newer(range.minimum,version)||max&&(/^\d+$/.test(max)?Number(String(version).split('.')[0])>Number(max):newer(version,max)));
};

/** Resolve only selected integrations and their required modules. Never change unrelated choices. */
export function integrationPlan(selected, game = globalThis.game) {
  const config = configuration(game), enable = new Set(), visiting = new Set();
  const visit = id => {
    const module = game.modules.get(id);
    if (!module) throw Error(`Required module is not installed: ${id}.`);
    if (enabled(module,config) || enable.has(id)) return;
    if (visiting.has(id)) throw Error(`Module dependency cycle: ${module.title ?? id}.`);
    if (module.incompatible || outsideFoundry(game.version ?? game.release?.version, module.compatibility)) throw Error(`${module.title ?? id} ${module.version??''} is incompatible with Foundry ${game.version??game.release?.version}. Check for a compatible module update.`);
    const systems = rows(module.relationships?.systems), system = systems.find(s => s.id === game.system.id);
    if (systems.length && !system || system && outside(game.system.version,system.compatibility)) throw Error(`${module.title ?? id} is incompatible with this game system.`);
    visiting.add(id);
    for (const dependency of rows(module.relationships?.requires)) {
      if (dependency.type && dependency.type !== 'module') continue;
      const required = game.modules.get(dependency.id);
      if (!required) throw Error(`${module.title ?? id} requires ${dependency.id}, which is not installed.`);
      if (outside(required.version,dependency.compatibility)) throw Error(`${module.title ?? id} requires a different version of ${required.title ?? dependency.id}.`);
      visit(dependency.id);
    }
    visiting.delete(id); enable.add(id);
  };
  for (const id of new Set(selected)) {
    if (!INTEGRATIONS.some(m => m.id === id)) throw Error(`Unknown KG Realms integration: ${id}.`);
    visit(id);
  }
  return {config:Object.assign(config,Object.fromEntries([...enable].map(id=>[id,true]))),enable:[...enable]};
}

export function installedIntegrations(game = globalThis.game) {
  const config = configuration(game);
  return INTEGRATIONS.flatMap(info => {
    const module = game.modules.get(info.id); if (!module) return [];
    const active = enabled(module,config); let issue = '';
    if (!active) try { integrationPlan([info.id],game); } catch (error) { issue = error.message; }
    return [{...info,active,issue}];
  });
}

export function shouldPromptIntegrations(game = globalThis.game) {
  return permitted(game) && game.user === game.users?.activeGM
    && (game.settings.get(ID,SETTING) ?? 'pending') === 'pending'
    && installedIntegrations(game).some(module => !module.active && !module.issue);
}

export async function saveIntegrations(selected, game = globalThis.game) {
  if (!permitted(game)) throw Error('Only a GM with settings permission can enable integrations.');
  const plan = integrationPlan(selected,game);
  if (plan.enable.length) await game.settings.set('core','moduleConfiguration',plan.config);
  await game.settings.set(ID,SETTING,game.settings.get(ID,SETTING) === 'never' ? 'never' : 'complete');
  // Same world reload used by Foundry's settings, after both writes have completed.
  game.socket.emit('reload');
  foundry.utils.debouncedReload();
}

export async function dismissIntegrations(game = globalThis.game) {
  if (!permitted(game)) throw Error('Only a GM with settings permission can dismiss integration setup.');
  await game.settings.set(ID,SETTING,'never');
}

const esc = value => foundry.utils.escapeHTML(String(value ?? ''));
export function integrationSetupContent(game = globalThis.game) {
  const installed = installedIntegrations(game);
  const section = (title, list) => !list.length ? '' : `<section><h3>${title}</h3>${list.map(m=>`<div class="kgr-integration-row"><div><strong>${esc(m.name)}</strong><p>${esc(m.use)}</p>${m.issue?`<p class="kgr-integration-error">${esc(m.issue)}</p>`:''}</div>${m.active?'<span class="kgr-integration-enabled">Already Enabled</span>':`<label><input type="checkbox" name="integration" value="${m.id}" aria-label="Enable ${esc(m.name)}" ${m.issue?'disabled':''}> Enable</label>`}</div>`).join('')}</section>`;
  return `<form class="kgr-integrations"><p>We detected the following installed modules.</p>
    ${section('Recommended',installed.filter(m=>m.recommended))}
    ${section('Compatible/integrated optionals',installed.filter(m=>!m.recommended))}
    ${installed.length?'':'<p>No supported integrations are installed.</p>'}
    <p data-integration-dependencies role="status" hidden></p><p data-integration-error class="kgr-integration-error" role="alert" hidden></p>
    <footer><button type="submit" class="primary">Save and Reload</button><button type="button" data-integration-action="later">Maybe Later</button><button type="button" data-integration-action="never">Don't Show Again</button></footer></form>`;
}

let Setup, current;
export function integrationSetupMenu() {
  return class IntegrationSetup extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {id:'kgr-integration-setup',tag:'div',classes:['kgr-ui'],window:{title:'KG Realms: Module integrations',icon:'fa-solid fa-puzzle-piece'},position:{width:580,height:'auto'}};
    async _renderHTML() { return integrationSetupContent(); }
    _replaceHTML(html,element) { element.innerHTML=html; }
    async _preFirstRender(...args) {
      await super._preFirstRender(...args);
      if (current && current !== this) await current.close();
      current=this;
    }
    _onRender() {
      const form=this.element.querySelector('form'),error=form.querySelector('[data-integration-error]'),dependencies=form.querySelector('[data-integration-dependencies]');
      const selected=()=>[...form.querySelectorAll('input[name="integration"]:checked')].map(input=>input.value);
      const report=message=>{error.textContent=message;error.hidden=!message;};
      form.addEventListener('change',()=>{
        try {
          const ids=selected(),extra=integrationPlan(ids).enable.filter(id=>!ids.includes(id));
          dependencies.textContent=extra.length?`Required modules also enabled: ${extra.map(id=>game.modules.get(id)?.title??id).join(', ')}.`:'';
          dependencies.hidden=!extra.length;report('');
        } catch (e) {dependencies.hidden=true;report(e.message);}
      });
      const run=async action=>{
        if(this.busy)return;this.busy=true;report('');
        form.querySelectorAll('button').forEach(button=>button.disabled=true);
        try {
          if(action==='save')await saveIntegrations(selected());
          else if(action==='never')await dismissIntegrations();
          await this.close();
        } catch(e) {report(e.message);}
        finally {this.busy=false;form.querySelectorAll('button').forEach(button=>button.disabled=false);}
      };
      form.addEventListener('submit',event=>{event.preventDefault();run('save');});
      form.addEventListener('click',event=>{const action=event.target.closest('[data-integration-action]')?.dataset.integrationAction;if(action)run(action);});
    }
    async _onClose(...args) {if(current===this)current=null;await super._onClose(...args);}
  };
}

export function registerIntegrationSetup() {
  game.settings.register(ID,SETTING,{scope:'world',config:false,type:String,default:'pending'});
  Setup=integrationSetupMenu();
  game.settings.registerMenu(ID,'integrationSetupMenu',{name:'Module integrations',label:'Review integrations',hint:'Review installed recommended and compatible modules.',icon:'fa-solid fa-puzzle-piece',type:Setup,restricted:true});
}

export function promptIntegrations() {
  if (!shouldPromptIntegrations()) return;
  if (current?.rendered) return current.bringToFront();
  current=new Setup();return current.render({force:true});
}
