import {MapAssetStore,sameGeometry} from './asset-store.mjs';
import {KtxDecoder} from './ktx-decoder.mjs';
import {TerrainLayer} from './terrain-layer.mjs';
import {mapAssetsMenu} from './ui-map-assets.mjs';
import {worldDef,worldUrl,defaultWorldId} from '../worlds.mjs';
const ID='kg-realms';
export class MapAssets {
  constructor({onChange=()=>{},store=new MapAssetStore()}={}){
    this.store=store;this.decoder=new KtxDecoder(store);this.onChange=onChange;this.prompted=new Set();this.rendererStatus={state:'idle'};
    store.on(s=>{
      if(s.state==='ready'&&this.lastReady!==s.revision){this.lastReady=s.revision;this.refresh();}
      // A problem with saved files: said once, not a window (Ctrl+Shift+M opens it).
      if(s.issue&&this.store.choice==='local'&&!this.window&&this.lastIssue!==s.issue){this.lastIssue=s.issue;globalThis.ui?.notifications?.warn(`KG Realms: ${s.issue} Press Ctrl+Shift+M to manage map files.`);}
    });
  }
  install(){
    const change=()=>this.refresh();
    // KTX2 only (0.65.6): the WebP tile archive is no longer shipped for Toril. Kept registered, hidden,
    // so an old 'webp' choice reads harmlessly; nothing consults it.
    game.settings.register(ID,'realmTerrainRenderer',{scope:'client',config:false,type:String,default:'ktx2'});
    game.settings.register(ID,'realmTerrainBudget',{name:'Realm terrain texture budget',hint:'Owned GPU texture payload only. Other Foundry graphics and decoding memory are additional.',scope:'client',config:true,type:Number,default:128,choices:{64:'64 MiB',128:'128 MiB',256:'256 MiB'},onChange:change});
    this.Menu=mapAssetsMenu(this);
    game.settings.registerMenu(ID,'mapAssets',{name:'Map files on this computer',label:'Manage map files',hint:'Choose a local folder, download, resume, repair, or use streaming.',icon:'fa-solid fa-download',type:this.Menu,restricted:false});
    game.keybindings.register(ID,'mapAssets',{name:'Manage local map files',editable:[{key:'KeyM',modifiers:['Control','Shift']}],restricted:false,onDown:()=>{this.show();return true;}});
  }
  async prepare(context){
    if(context)this.context=context;
    if(!this.testWarning&&globalThis.game?.modules?.get('kg-realms-ktx2-test')?.active){this.testWarning=true;globalThis.ui?.notifications?.warn('KG Realms: disable the standalone KG Realms KTX2 Terrain Test module when using this renderer.',{permanent:true});}
    // One world's pack at a time: another world's scene loads its own (homebrew worlds, 0.74).
    const wanted=this.context?.world??defaultWorldId();
    if(this.loadingWorld!==wanted){this.loading=null;this.loadingWorld=wanted;}
    this.loading??=(async()=>{
      await this.store.restore();
      try{
        // The world's terrain download (its definition's terrainPack, worlds.mjs): tiles come from its
        // module, or from beside a homebrew world's data (its assetBase).
        const world=worldDef(wanted);
        if(!world?.terrainPack)throw Error('This world has no realm terrain to download.');
        this.packWorld=world.id;this.store.base=this.store.requests.base=world.assetBase??`modules/${world.module}`;
        const route=worldUrl(world.id,world.terrainPack);
        const res=await fetch(route,{cache:'no-cache'});if(!res.ok)throw Error(`Map manifest HTTP ${res.status}`);
        this.store.setManifest(await res.json());
      }catch(e){
        if(this.store.installed)this.store.setManifest(this.store.installed);
        else{this.loadError=e.message;this.store.issue=e.message;this.store.emit();console.warn('kg-realms | map assets',e);}
      }
    })();
    await this.loading;
    // The world's map moved since its pack was read (a homebrew world's settings, 0.74.2's move): read it again, once.
    if(this.context?.sourceMap&&this.context.world===this.packWorld&&this.store.manifest&&!sameGeometry({sourceMap:this.context.sourceMap},this.store.manifest)&&!this.reread){
      this.reread=true;this.loading=null;try{return await this.prepare();}finally{this.reread=false;}
    }
    return this.configuration();
  }
  configuration(){
    if(!this.store.manifest)return null;
    const context=this.context;
    if(context&&(context.world!==this.packWorld||!context.sourceMap||!sameGeometry({sourceMap:context.sourceMap},this.store.manifest)))return null;
    const installed=this.store.choice==='local'&&this.store.installed;
    const catalog=installed&&sameGeometry(installed,this.store.manifest)?installed:this.store.manifest;
    return {makeLayer:()=>new TerrainLayer({catalog,budgetBytes:(Number(game.settings.get(ID,'realmTerrainBudget'))||128)*1048576,
      loadKtx:t=>this.decoder.acquire(t),releaseKtx:t=>this.decoder.release(t),onStatus:s=>{
        this.rendererStatus=s;
        if(s.state==='failed'){this.rendererError=s.error??s.errors?.[0]?.error??'Compressed map rendering is unavailable on this client.';this.store.issue=this.rendererError;this.store.emit();}
        else if(s.state==='ready'&&this.rendererError){if(this.store.issue===this.rendererError)this.store.issue=null;this.rendererError=null;this.store.emit();}
      }})};
  }
  refresh(){return Promise.resolve(this.onChange(this.configuration())).catch(e=>{this.store.issue=e.message;this.store.emit();});}
  afterDraw(){
    const s=this.store.status(),key=this.store.manifest?.fingerprint;
    if(!key||this.prompted.has(key))return;
    // Streaming is the default; the window opens only with Ctrl+Shift+M (or the settings button).
    // Saved files that need updating or reconnecting get a note, once.
    const update=s.choice==='local'&&(!s.upToDate||s.state==='reconnect');
    if(update){this.prompted.add(key);globalThis.ui?.notifications?.info(`KG Realms: your saved map files ${s.state==='reconnect'?'need their folder reconnected':'are out of date'}. Press Ctrl+Shift+M to manage them.`);}
  }
  /** The name of the world whose map this is (for the map files window). */
  worldName(){const w=worldDef(this.loadingWorld??this.context?.world??defaultWorldId());return w?.mapName??w?.title??'this world';}
  show(){if(!this.Menu)return;this.window??=new this.Menu();this.window.render({force:true});}
  status(){return {files:this.store.status(),renderer:{...this.rendererStatus}};}
}
