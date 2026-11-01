import {test} from "node:test";
import assert from "node:assert/strict";
import {hazardDefaults,isHazard,isRiverHazard,hazardSubtype,normalizeEncounter,encounterFile,readEncounterFile} from "../scripts/river-hazards.mjs";
import {RoadEditor} from "../scripts/ui-roads.mjs";
test("rapids and waterfalls use the Hazard parent and legacy records retain their identity and assets",()=>{
 for(const subtype of ["rapids","waterfall"]){const e=hazardDefaults(subtype);assert.equal(e.kind,"hazard");assert.equal(e.subtype,subtype);assert.equal(isRiverHazard(e),true);}
 const old={kind:"waterfall",name:"The Shining Falls",lon:-71,lat:61,scene:"scene",img:"image.webp",actors:["Actor.a"],group:"River Delimbiyr"},e=normalizeEncounter(old);
 assert.equal(e.kind,"hazard");assert.equal(hazardSubtype(e),"waterfall");assert.equal(e.img,old.img);assert.deepEqual(e.actors,old.actors);assert.equal(old.kind,"waterfall");assert.equal(isHazard(old),true);
});
test("encounter exports round-trip IDs, discovery, groups, notes and linked assets",()=>{
 const all={fall:{...hazardDefaults("waterfall"),lon:-70,lat:63,group:"River Never",known:"Public",gmNotes:"Secret",scene:"scene",images:["pic.webp"],autoDiscover:false},plain:{name:"Bandits",lon:-71,lat:62,group:"Road encounters",dc:0}};
 const data=readEncounterFile(JSON.parse(JSON.stringify(encounterFile(all,"toril"))));assert.deepEqual(data.fall,all.fall);assert.equal(data.plain.dc,0);assert.equal(encounterFile(all,"toril").world,"toril");
 assert.throws(()=>readEncounterFile({encounters:{a:{lon:"bad",lat:1}}}),/position/);
});
test("the editor lists all placed encounters and hazards, even while another is being placed",async()=>{
 globalThis.foundry={utils:{deepClone:o=>structuredClone(o),escapeHTML:s=>String(s).replaceAll('"',"&quot;"),saveDataToFile:(...a)=>globalThis.savedEncounterFile=a}};
 let all={f:{kind:"waterfall",name:"Shining Falls",lon:-70,lat:63,group:"River"},b:{name:"Bandits",lon:-71,lat:62}};
 const editor=new RoadEditor({getEncounters:()=>all,getWorld:()=>"toril",saveEncounters:async fn=>all=fn(all)});editor.placing=true;
 const html=editor.encounterList();assert.ok(html.includes("Hazards"));assert.ok(html.includes("Encounters"));assert.ok(html.includes("Shining Falls"));assert.ok(html.includes("River"));assert.ok(html.includes("Waterfall"));
 editor.exportEncounters();assert.equal(savedEncounterFile[2],"encounters.json");assert.equal(JSON.parse(savedEncounterFile[0]).encounters.f.kind,"hazard");
 await editor.importEncounterData({encounters:{r:{...hazardDefaults("rapids"),lon:-72,lat:61}}});assert.ok(all.f&&all.b&&all.r);
});
