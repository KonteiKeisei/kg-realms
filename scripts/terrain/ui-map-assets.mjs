import {formatBytes,formatDuration,formatEta} from './download-progress.mjs';
export function mapAssetsMenu(service){
  const {ApplicationV2}=foundry.applications.api;
  const format=n=>n>=1073741824?`${(n/1073741824).toFixed(2)} GiB`:`${(n/1048576).toFixed(1)} MiB`;
  return class MapAssetsMenu extends ApplicationV2 {
    static DEFAULT_OPTIONS={id:'kgr-map-assets',classes:['kgr-ui','kgr-map-assets'],window:{title:'KG Realms: map files',icon:'fa-solid fa-download'},position:{width:540,height:'auto'}};
    constructor(...args){super(...args);this.stop=service.store.on(()=>this.refresh());}
    async _renderHTML(){await service.prepare();return `<div class="kgr-assets-body">
      <p>Save <span data-map-world>${foundry.utils.escapeHTML(service.worldName?.() ?? "this world")}</span>'s map artwork on this computer. Future visits read the saved files. Each world's map is saved or streamed on its own.</p>
      <div class="kgr-assets-message" data-message role="status"></div>
      <dl class="kgr-assets-totals"><dt>Map package</dt><dd data-total></dd><dt>Already saved</dt><dd data-saved></dd><dt>Download remaining</dt><dd data-remaining></dd><dt>Additional disk space needed</dt><dd data-space></dd></dl>
      <div class="kgr-assets-folder"><span>Folder</span><strong data-folder>Not selected</strong><small>The module creates its own KG Realms subfolder here.</small></div>
      <div class="kgr-assets-actions"><button type="button" data-act="choose"><i class="fa-solid fa-folder-open"></i> Choose folder</button><button type="button" data-act="reconnect">Reconnect folder</button></div>
      <div class="kgr-assets-progress-head"><strong data-percent></strong><span data-session></span></div>
      <progress data-progress value="0" max="1" aria-label="Map files verified and saved"></progress><p data-progress-text></p>
      <dl class="kgr-assets-transfer" data-transfer><div><dt data-speed-label>Speed</dt><dd data-speed></dd></div><div><dt>Time remaining</dt><dd data-eta></dd></div><div><dt>Elapsed</dt><dd data-elapsed></dd></div></dl>
      <div class="kgr-assets-actions"><button type="button" class="primary" data-act="download">Download map files</button><button type="button" data-act="pause">Pause</button><button type="button" data-act="cancel">Cancel download</button></div>
      <div class="kgr-assets-actions"><button type="button" data-act="repair">Verify and repair</button><button type="button" data-act="stream">Use streaming instead</button></div>
      <p class="kgr-assets-note">Downloads can resume. Closing this window leaves a running download active. Folder access may need reconnecting after a browser restart. Foundry still needs its server connection.</p>
    </div>`;}
    _replaceHTML(html,content){
      if(!this.content){this.content=content;content.innerHTML=html;content.addEventListener('click',e=>{const action=e.target.closest('[data-act]')?.dataset.act;if(action)this.act(action);});}
      this.refresh();
    }
    refresh(){
      if(!this.content?.isConnected)return;
      if(this.paintPending)return;this.paintPending=requestAnimationFrame(()=>{this.paintPending=null;this.paint();});
    }
    paint(){
      const c=this.content,s=service.store.status();if(!c?.isConnected)return;
      if(s.active&&!this.tick)this.tick=setInterval(()=>this.refresh(),500);
      else if(!s.active&&this.tick){clearInterval(this.tick);this.tick=null;}
      const text=(q,v)=>c.querySelector(q).textContent=v;
      text('[data-map-world]',service.worldName?.() ?? 'this world');
      text('[data-total]',format(s.totalBytes));text('[data-saved]',format(s.doneBytes));text('[data-remaining]',format(s.remainingBytes));
      text('[data-space]',format(s.spaceNeededBytes));
      text('[data-folder]',s.folderLabel??'Not selected');
      const phrases={checking:'Checking saved files. No download has started.',downloading:'Downloading map files.',pausing:'Finishing the current files, then stopping.',paused:'Paused. Completed files are saved.',cancelled:'Download cancelled. Completed files are kept for resuming.',ready:'Map files are saved and ready to use.',reconnect:'Reconnect the saved folder to use local maps.'};
      let message=s.issue??s.warning??phrases[s.state]??(s.upToDate?'The current map package is saved.':s.installed?'A map update is available. Only changed files are needed.':'Choose a folder to save the map package.');
      if(!s.issue&&s.retry&&s.state==='downloading')message=`The server is temporarily unavailable${s.retry.status?` (HTTP ${s.retry.status})`:''}. Retrying ${s.retry.path.split('/').pop()} after a short wait. Completed files are saved.`;
      if(!s.supported)message='This browser cannot choose a persistent map folder. Use streaming, or open Foundry over HTTPS in a supported desktop browser.';
      text('[data-message]',message);c.querySelector('[data-message]').classList.toggle('error',!!s.issue);
      const progress=c.querySelector('[data-progress]');progress.max=s.totalBytes||1;progress.value=s.doneBytes;
      const percent=s.totalBytes?Math.min(s.doneBytes<s.totalBytes?99.9:100,s.doneBytes/s.totalBytes*100):0;
      text('[data-percent]',`${percent.toFixed(1)}% saved`);
      text('[data-progress-text]',`${s.completed.toLocaleString()} of ${s.files.toLocaleString()} files saved (${(s.files-s.completed).toLocaleString()} remaining)`);
      const t=s.transfer,live=s.state==='downloading'||s.state==='pausing';
      text('[data-session]',t.transferredBytes?`${formatBytes(t.transferredBytes)} downloaded this run`:'');
      c.querySelector('[data-transfer]').hidden=!s.active&&!t.elapsedMs;
      text('[data-speed-label]',s.active?'Speed':'Average speed');
      const speed=s.active?t.bytesPerSecond:t.elapsedMs>0?t.transferredBytes/(t.elapsedMs/1000):null;
      text('[data-speed]',s.state==='checking'?'Checking files...':speed==null?'Measuring...':`${formatBytes(speed)}/s`);
      text('[data-eta]',s.state==='checking'?'Checking files...':s.retry?'Waiting to retry':live?formatEta(t.etaSeconds):s.upToDate?'Complete':s.state==='paused'?'Paused':s.state==='cancelled'?'Cancelled':'Stopped');
      text('[data-elapsed]',formatDuration(t.elapsedMs/1000));
      const button=a=>c.querySelector(`[data-act="${a}"]`);
      button('choose').disabled=!s.supported||s.active||!s.files;button('reconnect').hidden=!s.folder;button('reconnect').disabled=s.active||!s.supported;
      button('download').disabled=!s.files||!s.folder||s.active||!s.supported||s.state==='reconnect';button('repair').disabled=!s.files||!s.folder||s.active||!s.supported;
      button('download').textContent=s.remainingBytes?`Download ${format(s.remainingBytes)}`:'Use saved maps';
      button('download').hidden=s.active;
      if(s.upToDate&&s.choice==='local'){button('download').textContent='Using saved maps';button('download').disabled=true;}
      button('pause').hidden=!s.active;button('cancel').hidden=!s.active;button('stream').disabled=s.active;
    }
    async act(action){
      if(this.actionBusy)return;
      if(action==='pause'){service.store.pause();return;}
      if(action==='cancel'){service.store.cancel();return;}
      this.actionBusy=true;
      try{
        if(action==='choose'){const pending=service.store.choose();await pending;await service.store.scan({verify:true});}
        if(action==='reconnect'){const pending=service.store.reconnect();await pending;await service.store.scan({verify:true});service.refresh();}
        if(action==='download'||action==='repair'){
          const useSaved=action==='download'&&service.store.status().remainingBytes===0;
          if(action==='repair')service.store.lastScan=null;
          // Keep Pause and Cancel usable while the asynchronous job runs.
          this.actionBusy=false;await service.store.download();if(useSaved&&service.store.state==='ready')service.refresh();
        }
        if(action==='stream'){await service.store.stream();service.refresh();}
      }catch(e){if(e.name!=='AbortError'){service.store.issue=e.message;service.store.emit();}}
      finally{this.actionBusy=false;this.refresh();}
    }
    async close(...args){this.stop?.();if(this.tick)clearInterval(this.tick);this.tick=null;if(this.paintPending)cancelAnimationFrame(this.paintPending);service.window=null;return super.close(...args);}
  };
}
