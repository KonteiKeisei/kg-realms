import {fromWorld,toWorld} from './geo.mjs';
import {crossingVisible,placeSeen,placeOnLayer,ordinaryPlaceVisible,regionalMapEntryLayer} from './place-display.mjs';
// A flat sheet in tile space. Source pixels remain square at every zoom.
export const SOURCE_MAP={width:12840,height:9150,tileSize:512,nativeZoom:7,detailZoom:9,maxZoom:22,minZoom:0,x:16384,y:16384,worldSize:65536,milesPerPixel:500/1700,archive:'tapestry.pmtiles'};
export function sourceToLonLat(x,y,sheet=SOURCE_MAP){const p=fromWorld((sheet.x+x)/sheet.worldSize,(sheet.y+y)/sheet.worldSize);return [p.lon,p.lat];}
export function lonLatToSource(lon,lat,sheet=SOURCE_MAP){const p=toWorld(lat,lon);return [p.x*sheet.worldSize-sheet.x,p.y*sheet.worldSize-sheet.y];}
export function sourceMiles(a,b){const p=lonLatToSource(a.lon,a.lat),q=lonLatToSource(b.lon,b.lat);return Math.hypot(q[0]-p[0],q[1]-p[1])*SOURCE_MAP.milesPerPixel;}
function sheetBounds(){const nw=sourceToLonLat(0,0),se=sourceToLonLat(SOURCE_MAP.width,SOURCE_MAP.height);SOURCE_MAP.bounds={west:nw[0],north:nw[1],east:se[0],south:se[1],mapWidthMiles:SOURCE_MAP.width*SOURCE_MAP.milesPerPixel};}
sheetBounds();
const DEFAULT_SHEET = structuredClone(SOURCE_MAP);
/** A projection owned by one world, independent of the displayed map. */
export function sourceProjection(sheet = DEFAULT_SHEET) {
 const sourceMap = structuredClone(sheet ?? DEFAULT_SHEET);
 return { sourceMap, toSource: (lon, lat) => lonLatToSource(lon, lat, sourceMap), toLonLat: (x, y) => sourceToLonLat(x, y, sourceMap) };
}
/**
 * The sheet of the world being drawn (its index's sourceMap): the values above are Toril's, used until
 * a world gives its own. One realm map is drawn at a time, so the sheet is shared (0.71).
 */
export function applySourceMap(sheet){
 if(!sheet||!Number.isFinite(sheet.width)||!Number.isFinite(sheet.milesPerPixel))return;
 const {bounds,...rest}=sheet;Object.assign(SOURCE_MAP,rest);sheetBounds();
}

/** The red of the map's printed roads. */
export const ROAD_RED='#b52a1f';
/** Brighter at night, so roads read on the darkened map. */
export const ROAD_RED_NIGHT='#e0533a';

/**
 * The map zooms at which lesser places appear: regional (rank 4) and local (everything). A zoom only
 * means something against its map's size: nativeZoom shows the picture at full size. Toril, with its
 * detail tiles and nearly 2,000 places, keeps the zooms it was tuned to; a made world shows every place
 * from half its picture's full size, and its rank 4 places at the whole-map view.
 */
export function placeZooms(sheet = SOURCE_MAP) {
  if ((sheet.detailZoom ?? sheet.nativeZoom) > sheet.nativeZoom) return { regional: 5.5, local: 7.5 };
  return { regional: sheet.nativeZoom - 2.5, local: sheet.nativeZoom - 1 };
}
export function sourceMapStyle({tiles,glyphs,sourceMap=SOURCE_MAP,attribution='',markerScale=1,labelScale=1,look='day',dim=true,mapLights=false}){
 const night=look==='night';
 // Module settings scale markers and names; zoom stops must stay top level, so each stop scales.
 const ls=(v)=>typeof v==='number'?v*labelScale:v.map((x,i)=>i>=4&&i%2===0?x*labelScale:x);
 const empty={type:'FeatureCollection',features:[]},b=sourceMap.bounds;
 // Added places draw like every other place. Hidden places draw for the GM only, faded (global state gm).
 // The map's layers (map-layers.mjs): a place shows when its layer is enabled; an area with an outline
 // shows its name from the areas source instead.
 const onLayer=placeOnLayer;
 const journeyMarkVisible=['any',['!=',['get','kind'],'encounter'],['global-state','gm']];
 const encounterVisible=['any',['global-state','gm'],['all',['get','hazard'],['get','public']]];
 const seen=placeSeen;
 const visible=['all',ordinaryPlaceVisible,['!',['get','outlined']]];
 const faded=['case',['get','hidden'],0.4,1];
 const color=['match',['get','class'],'Sea','#d9e9e8','Lake','#cce0df','River','#cce0df','Forest','#f2ead5','Marsh','#f2ead5','Swamp','#f2ead5','#332d26'];
 // A place marker in the map key's style beside its name; natural features
 // (forests, rivers, regions) are name only, centred.
 const zooms=placeZooms(sourceMap);
 const dot=['!=',['get','icon'],''];
 const weight=['match',['get','symbol'],'city',1.15,'town',0.95,'village',0.8,0.85];
 const pic=['==',['slice',['get','icon'],0,3],'mk-'];
 const picScale=['case',pic,['match',['get','symbol'],'city',0.45,0.375],1];
 const priority=['+',['*',10,['get','rank']],['match',['get','symbol'],'city',0,'town',2,'keep',4,'village',5,'',8,6]];
 // What shows by zoom is decided by the settled zoom (realm-layer.mjs #settle): once the zoom has been
 // still a moment, not live while it changes, so names, places and roads come and go together.
 const gate=(min,max)=>['all',...(min?[['>=',['global-state','settledZoom'],min]]:[]),...(max?[['<',['global-state','settledZoom'],max]]:[])];
 const poi=(id,minzoom,maxzoom,filter,size,fixed)=>({id,type:'symbol',source:'places',filter:['all',filter,gate(minzoom,maxzoom)],layout:{
  // A picture marker that cannot be drawn falls back to the place's map-key symbol.
  'icon-image':['coalesce',['image',['get','icon']],['image',['get','fallback']]],
  // Markers keep a readable size zoomed out; cities are a little larger than towns and sites.
  // Picture markers fill their 64 px images; a key symbol's circle, with its edge, is 24 px of its 48
  // (a city's, 30). Scale pictures to match the circle of the same kind of place.
  'icon-size':['interpolate',['linear'],['zoom'],2,['*',0.85*markerScale,weight,picScale],6,['*',0.9*markerScale,weight,picScale],9,['*',1.1*markerScale,weight,picScale],12,['*',1.4*markerScale,weight,picScale]],
  // Zoomed out, markers collide and the most important ones win (cities first).
  'icon-allow-overlap':!!fixed,'icon-ignore-placement':!!fixed,'icon-padding':2,
  'text-field':['get','name'],'text-font':['case',dot,['literal',['Noto Sans Medium']],['literal',['Noto Sans Italic']]],'text-size':ls(size),'text-max-width':12,'text-optional':true,
  ...(fixed?{}:{'text-anchor':['case',dot,'left','center'],'text-offset':['case',dot,['literal',[0.7,0]],['literal',[0,0]]]}),
  // Close in, every marker shows; names move to a free side, and hide only where there is no room.
  ...(fixed?{'text-variable-anchor':['left','right','top','bottom'],'text-radial-offset':0.9,'text-justify':'auto'}:{}),'symbol-sort-key':priority},
  paint:{'text-color':'#ffffff','text-halo-color':'#0b0b0b','text-halo-width':1.8,'text-halo-blur':0.3,'icon-opacity':faded,'text-opacity':faded}});
 return {version:8,glyphs,state:{editing:{default:false},gm:{default:false},travelRoutes:{default:[]},phase:{default:0},settledZoom:{default:0},mapLayers:{default:['places']}},sources:{
  tapestry:{type:'raster',tiles:[tiles.tapestry],tileSize:sourceMap.tileSize,minzoom:0,maxzoom:sourceMap.detailZoom??sourceMap.nativeZoom,bounds:[b.west,b.south,b.east,b.north],attribution},
  ...(tiles.routes?{routes:{type:'geojson',data:tiles.routes}}:{}),
  places:{type:'geojson',data:empty},flash:{type:'geojson',data:empty},
  areas:{type:'geojson',data:empty},'area-labels':{type:'geojson',data:empty},'area-edit':{type:'geojson',data:empty},'area-edit-nodes':{type:'geojson',data:empty},
  'route-edit':{type:'geojson',data:empty},'route-nodes':{type:'geojson',data:empty},
  journey:{type:'geojson',data:empty},'journey-camps':{type:'geojson',data:empty},encounters:{type:'geojson',data:empty},
  waterways:{type:'geojson',data:empty}
 },layers:[
  {id:'background',type:'background',paint:{'background-color':'#171717'}},
  {id:'tapestry',type:'raster',source:'tapestry',paint:{'raster-fade-duration':0,'raster-resampling':'linear',...(night&&dim?{'raster-brightness-max':0.42,'raster-saturation':-0.35,'raster-contrast':0.05}:{})}},
  // Night: settlements glow, sized to the settlement, each flickering on its own (seed).
  ...(night&&mapLights?(()=>{
   const size=['match',['get','class'],'City',1,'Town',0.62,'Village',0.42,'Hamlet',0.3,['match',['get','kind'],'settlement',0.34,0.22]];
   const flick=['+',0.78,['*',0.16,['sin',['+',['*',['global-state','phase'],1.7],['*',['get','seed'],5]]]],['*',0.08,['sin',['+',['*',['global-state','phase'],4.3],['get','seed']]]]];
   const lit=['all',onLayer,crossingVisible,['!',['get','hidden']],['!=',['slice',['get','name'],0,5],'Ruins'],['!=',['get','symbol'],'ruin'],['any',['==',['get','kind'],'settlement'],['in',['get','class'],['literal',['Fortification','Keep','Fort','Castle','Temple','Inn']]]]];
   const r=(k)=>['interpolate',['exponential',1.6],['zoom'],3,['*',k*14,size],7,['*',k*44,size],10,['*',k*120,size],13,['*',k*320,size]];
   return [
    {id:'night-glow',type:'circle',source:'places',filter:lit,paint:{'circle-color':'#ff8a2a','circle-radius':r(1),'circle-blur':0.9,'circle-opacity':['*',0.8,flick],'circle-pitch-scale':'map'}},
    {id:'night-core',type:'circle',source:'places',filter:lit,paint:{'circle-color':'#ffe39a','circle-radius':r(0.32),'circle-blur':0.6,'circle-opacity':['*',0.95,flick]}}
   ];
  })():[]),
  // Areas (Realms and Geography layers): a light wash of colour inside a border; realms dashed in
  // their own colour, the land green and the water blue, dotted.
  {id:'area-fill',type:'fill',source:'areas',filter:['all',['==',['geometry-type'],'Polygon'],onLayer,seen],paint:{'fill-color':['match',['get','kind'],'water','#3d8fb8','land','#5e8f3c',['get','color']],'fill-opacity':['match',['get','kind'],'realm',0.14,0.11]}},
  {id:'area-line-realm',type:'line',source:'areas',filter:['all',['==',['get','kind'],'realm'],onLayer,seen],layout:{'line-join':'round'},paint:{'line-color':['get','color'],'line-opacity':0.9,'line-width':['interpolate',['exponential',1.5],['zoom'],2,1.2,7,2.6,10,4.5,13,7],'line-dasharray':[3,1.5,1,1.5]}},
  {id:'area-line-geo',type:'line',source:'areas',filter:['all',['!=',['get','kind'],'realm'],onLayer,seen],layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':['match',['get','kind'],'water','#2b6f94','#3c5d27'],'line-opacity':0.85,'line-width':['interpolate',['exponential',1.5],['zoom'],2,0.9,7,1.8,10,3,13,5],'line-dasharray':[0.5,2]}},
  // Roads and trails, drawn live in the map's red so their weight follows the zoom.
  // Major roads: a bold red line with a pale dashed centre. Minor roads and tracks:
  // long red dashes. Dash lengths are in line widths, so they scale with the line.
  ...(tiles.routes?[
   ...(night?[
    {id:'road-glow',type:'line',source:'routes',filter:['all',['==',['get','kind'],'road'],gate(2)],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#ff6945','line-opacity':0.52,'line-blur':['interpolate',['exponential',1.5],['zoom'],2,2,7,5,10,10,13,20],'line-width':['interpolate',['exponential',1.5],['zoom'],2,5,7,12,10,24,13,44]}},
    {id:'trail-glow',type:'line',source:'routes',filter:['all',['==',['get','kind'],'trail'],gate(4)],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#f05c43','line-opacity':0.32,'line-blur':['interpolate',['exponential',1.5],['zoom'],4,2,7,5,10,10,13,20],'line-width':['interpolate',['exponential',1.5],['zoom'],4,4,7,10,10,20,13,36]}}
   ]:[]),
   {id:'trails',type:'line',source:'routes',filter:['all',['==',['get','kind'],'trail'],gate(4)],layout:{'line-cap':'butt','line-join':'round'},paint:{'line-color':night?ROAD_RED_NIGHT:ROAD_RED,'line-opacity':['interpolate',['linear'],['zoom'],4,0.6,6,0.95],'line-width':['interpolate',['exponential',1.5],['zoom'],4,0.9,7,2.2,10,5,13,10],'line-dasharray':[3.5,2]}},
   {id:'roads',type:'line',source:'routes',filter:['all',['==',['get','kind'],'road'],gate(2)],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':night?ROAD_RED_NIGHT:ROAD_RED,'line-width':['interpolate',['exponential',1.5],['zoom'],2,0.8,7,4,10,9,13,18]}},
   {id:'road-centre',type:'line',source:'routes',filter:['all',['==',['get','kind'],'road'],gate(5.5)],layout:{'line-cap':'butt','line-join':'round'},paint:{'line-color':'#f5e9cc','line-opacity':['interpolate',['linear'],['zoom'],5.5,0,6.5,0.95],'line-width':['interpolate',['exponential',1.5],['zoom'],5.5,0.6,7,1.3,10,3,13,6],'line-dasharray':[3,3]}},
   {id:'route-travel',type:'line',source:'routes',filter:['in',['get','id'],['global-state','travelRoutes']],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#ffc94a','line-opacity':0.6,'line-blur':2,'line-width':['interpolate',['exponential',1.5],['zoom'],2,4,7,12,10,24,13,44]}}
  ]:[]),
  // A planned journey: a gold glow under the roads' red.
  ...(night?[{id:'journey-halo',type:'line',source:'journey',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['case',['get','water'],'#5cc4f0','#f0b95c'],'line-opacity':0.2,'line-blur':['interpolate',['exponential',1.5],['zoom'],2,9,7,18,10,32,13,56],'line-width':['interpolate',['exponential',1.5],['zoom'],2,13,7,27,10,50,13,90]}}]:[]),
  {id:'journey-glow',type:'line',source:'journey',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['case',['get','water'],night?'#74c6e6':'#2fa8e8',night?'#e6c674':'#ffc94a'],'line-opacity':night?0.55:0.55,'line-blur':night?4:3,'line-width':['interpolate',['exponential',1.5],['zoom'],2,5,7,11,10,22,13,38]}},
  {id:'journey-line',type:'line',source:'journey',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['case',['get','water'],night?'#b0e2f2':'#8fdcff',night?'#f2deb0':'#ffdf8a'],'line-opacity':night?0.72:1,'line-width':['interpolate',['exponential',1.5],['zoom'],2,1,7,2.2,10,4.5,13,8],'line-dasharray':[1,1.5]}},
  // Route marks: numbered stops (named beside them), the party, encounters, and small dots where nights fall.
  {id:'journey-camps',type:'circle',source:'journey-camps',filter:['all',journeyMarkVisible,['!',['in',['get','kind'],['literal',['camp','done']]]]],paint:{'circle-radius':['interpolate',['linear'],['zoom'],2,['match',['get','kind'],'stop',8,'here',7,'encounter',6,'via',3,2.5],8,['match',['get','kind'],'stop',11,'here',10,'encounter',8,'via',5,4],12,['match',['get','kind'],'stop',14,'here',13,'encounter',10,'via',6,5]],'circle-color':['match',['get','kind'],'stop','#ffc94a','via','#ffc94a','here','#4ad0ff','done','#8a8f80','encounter','#d8452b','#f4ecd8'],'circle-stroke-color':['case',['get','selected'],'#ffffff',['match',['get','kind'],'here','#0b2733','#1a1408']],'circle-stroke-width':['case',['get','selected'],4,['match',['get','kind'],'camp',1.5,'done',1.5,2.5]]}},
  // Where each night falls: a campground marker, grey once passed.
  {id:'journey-camp-icons',type:'symbol',source:'journey-camps',filter:['in',['get','kind'],['literal',['camp','done']]],layout:{'icon-image':['match',['get','kind'],'done','kgr-camp-done','kgr-camp'],'icon-size':['interpolate',['linear'],['zoom'],2,0.6,6,0.8,9,1,12,1.2],'icon-allow-overlap':true,'icon-ignore-placement':true}},
  {id:'journey-camp-labels',type:'symbol',source:'journey-camps',filter:['all',journeyMarkVisible,['!=',['get','label'],'']],layout:{'text-field':['get','label'],'text-font':['Noto Sans Medium'],'text-size':['interpolate',['linear'],['zoom'],2,11,8,13,12,15],'text-anchor':'center','text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':['match',['get','kind'],'here','#06202b','#1a1408']}},
  {id:'journey-stop-names',type:'symbol',source:'journey-camps',filter:['all',journeyMarkVisible,['!=',['get','name'],'']],layout:{'text-field':['get','name'],'text-font':['Noto Sans Medium'],'text-size':['interpolate',['linear'],['zoom'],2,13,8,15,12,18],'text-variable-anchor':['left','right','top','bottom'],'text-radial-offset':1.3,'text-justify':'auto','text-optional':true},paint:{'text-color':'#ffffff','text-halo-color':'#000000','text-halo-width':2}},
  // Ordinary encounters are GM-only; discovered river hazards also fill the player source.
  {id:'encounter-marks',type:'circle',source:'encounters',filter:encounterVisible,paint:{'circle-radius':['interpolate',['linear'],['zoom'],2,4,8,7,12,10],'circle-color':['match',['get','kind'],'rapids','#48b9dc','waterfall','#a8c9ff','#e0503c'],'circle-stroke-color':'#ffffff','circle-stroke-width':2}},
  {id:'encounter-labels',type:'symbol',source:'encounters',filter:['all',encounterVisible,gate(5)],layout:{'text-field':['get','name'],'text-font':['Noto Sans Italic'],'text-size':12,'text-offset':[0,1.2],'text-anchor':'top','text-optional':true},paint:{'text-color':'#ffd0c8','text-halo-color':'#2a0a06','text-halo-width':1.6}},
  // Area names: realms spread wide in capitals, the land and water in italic across the area.
  {id:'area-names',type:'symbol',source:'area-labels',filter:['all',onLayer,seen],layout:{'text-field':['get','name'],'text-font':['case',['==',['get','kind'],'realm'],['literal',['Noto Sans Medium']],['literal',['Noto Sans Italic']]],'text-transform':['match',['get','kind'],'realm','uppercase','none'],'text-letter-spacing':['match',['get','kind'],'realm',0.3,'water',0.2,0.08],'text-size':ls(['interpolate',['linear'],['zoom'],2,['case',['<=',['get','rank'],2],16,13],8,['case',['<=',['get','rank'],2],24,17],12,['case',['<=',['get','rank'],2],30,21]]),'text-max-width':10,'symbol-sort-key':['get','rank'],'text-padding':4},paint:{'text-color':['match',['get','kind'],'water','#cfeeff','land','#e6f4cc','#fff0e0'],'text-halo-color':['match',['get','kind'],'water','#0b2433','land','#14240b','#2a0f08'],'text-halo-width':1.8,'text-opacity':['case',['get','hidden'],0.4,1]}},
  {id:'area-line-names',type:'symbol',source:'areas',filter:['all',['==',['geometry-type'],'LineString'],onLayer,seen],layout:{'symbol-placement':'line','text-field':['get','name'],'text-font':['literal',['Noto Sans Italic']],'text-letter-spacing':0.12,'text-size':ls(['interpolate',['linear'],['zoom'],2,12,8,15,12,19])},paint:{'text-color':['match',['get','kind'],'water','#cfeeff','land','#e6f4cc','#fff0e0'],'text-halo-color':['match',['get','kind'],'water','#0b2433','land','#14240b','#2a0f08'],'text-halo-width':1.8}},
  poi('poi-labels-overview',0,zooms.regional,['all',...visible.slice(1),['any',['<=',['get','rank'],3],['==',['get','class'],'City']]],15),
  poi('poi-labels-regional',zooms.regional,zooms.local,['all',...visible.slice(1),['<=',['get','rank'],4]],15),
  poi('poi-labels-local',zooms.local,null,visible,['interpolate',['linear'],['zoom'],zooms.local,14,zooms.local+1.5,16,zooms.local+4.5,19],true),
  regionalMapEntryLayer({markerScale,labelScale}),
  {id:'settlements',type:'circle',source:'places',filter:['all',visible,['==',['get','kind'],'settlement']],paint:{'circle-radius':8,'circle-opacity':0}},
  {id:'sites',type:'circle',source:'places',filter:['all',visible,['!=',['get','kind'],'settlement']],paint:{'circle-radius':7,'circle-opacity':0}},
  {id:'place-glow',type:'circle',source:'places',filter:['all',['get','gold'],['!', ['get','hidden']],onLayer,crossingVisible],paint:{'circle-color':'#ffc94a','circle-opacity':.5,'circle-radius':15,'circle-blur':.7}},
  {id:'places-hidden',type:'circle',source:'places',filter:['all',['global-state','editing'],['get','hidden']],paint:{'circle-color':'transparent','circle-radius':4,'circle-stroke-color':'#e0707a','circle-stroke-width':1}},
  // The map editor's waterways (GM, Waterways tab only): shorelines gold and dashed, rivers blue,
  // Trade winds and currents green, sea routes pale; arrows along rivers, winds and currents the way they run.
  {id:'waterway-coast',type:'line',source:'waterways',filter:['==',['get','kind'],'coast'],paint:{'line-color':'#7fe0ff','line-opacity':0.85,'line-width':['interpolate',['linear'],['zoom'],2,0.8,8,1.5,12,2.5]}},
  {id:'waterway-sel',type:'line',source:'waterways',filter:['get','selected'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#ffffff','line-opacity':0.7,'line-width':['interpolate',['exponential',1.5],['zoom'],2,5,7,10,10,18,13,30]}},
  ...[['shore','#ffc94a',[2,1.5]],['lane','#e8d9b0',[1,1.2]],['river','#4ad0ff',null],['wind','#6fd36f',null]].map(([k,color,dash])=>({id:`waterway-${k}`,type:'line',source:'waterways',filter:['==',['get','kind'],k],layout:{'line-cap':dash?'butt':'round','line-join':'round'},paint:{'line-color':color,'line-opacity':0.95,'line-width':['interpolate',['exponential',1.5],['zoom'],2,k==='wind'?3:2,7,k==='wind'?7:4,10,k==='wind'?14:8,13,k==='wind'?24:14],...(dash?{'line-dasharray':dash}:{})}})),
  {id:'waterway-arrows',type:'symbol',source:'waterways',filter:['in',['get','kind'],['literal',['river','wind']]],layout:{'symbol-placement':'line','symbol-spacing':90,'text-field':'>','text-font':['Noto Sans Medium'],'text-size':['interpolate',['linear'],['zoom'],2,12,8,16,12,22],'text-keep-upright':false,'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':'#ffffff','text-halo-color':'#0b1a10','text-halo-width':1.5}},
  {id:'waterway-names',type:'symbol',source:'waterways',filter:['!=',['get','name'],''],layout:{'symbol-placement':'line','text-field':['get','name'],'text-font':['Noto Sans Italic'],'text-size':13,'text-offset':[0,1.1]},paint:{'text-color':'#ffffff','text-halo-color':'#000000','text-halo-width':1.8}},
  // The road editor: the selected or new route and its draggable nodes.
  {id:'route-edit-halo',type:'line',source:'route-edit',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#ffffff','line-opacity':0.75,'line-width':['interpolate',['exponential',1.5],['zoom'],2,4,7,9,10,16,13,28]}},
  {id:'route-edit-line',type:'line',source:'route-edit',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':night?ROAD_RED_NIGHT:ROAD_RED,'line-width':['interpolate',['exponential',1.5],['zoom'],2,1.5,7,4,10,9,13,18]}},
  {id:'route-edit-nodes',type:'circle',source:'route-nodes',paint:{'circle-radius':['case',['get','selected'],8,['get','end'],6.5,5],'circle-color':['case',['get','selected'],'#4ad0ff',['get','end'],'#ffc94a','#ffffff'],'circle-stroke-color':'#7a1810','circle-stroke-width':2}},
  // The map editor's area border (Places tab): the outline being drawn or edited and its corners.
  {id:'area-edit-line',type:'line',source:'area-edit',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#ffc94a','line-width':['interpolate',['exponential',1.5],['zoom'],2,2,7,3,10,4,13,6]}},
  {id:'area-edit-nodes',type:'circle',source:'area-edit-nodes',paint:{'circle-radius':['case',['get','handle'],10,['get','selected'],8,['get','first'],7,5.5],'circle-color':['case',['get','handle'],'#ffc94a',['get','selected'],'#4ad0ff',['get','first'],'#ffc94a','#fff4dc'],'circle-stroke-color':['case',['get','handle'],'#ffffff','#2a1d05'],'circle-stroke-width':['case',['get','handle'],3,2]}},
  {id:'area-edit-name',type:'symbol',source:'area-edit-nodes',filter:['get','handle'],layout:{'text-field':['get','name'],'text-font':['Noto Sans Medium'],'text-size':15,'text-anchor':'left','text-offset':[1.1,0],'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':'#ffe08a','text-halo-color':'#1a1408','text-halo-width':2}},
  {id:'flash-glow',type:'circle',source:'flash',paint:{'circle-color':'#ffc94a','circle-opacity':0,'circle-radius':22,'circle-blur':1}},
  {id:'flash-ring',type:'circle',source:'flash',paint:{'circle-color':'transparent','circle-radius':12,'circle-stroke-color':'#fff','circle-stroke-width':2.5,'circle-stroke-opacity':0}}
 ]};
}
