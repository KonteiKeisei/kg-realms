// Crossings are authoring handles. A linked Regional map is a destination on Places and Areas.
export const crossingVisible=['any',['!=',['get','regionalEntry'],true],['all',['global-state','gm'],['global-state','editing']]];
export const placeSeen=['any',['!', ['get','hidden']],['global-state','gm']];
export const placeOnLayer=['any',['in',['get','layer'],['global-state','mapLayers']],['all',['==',['get','regionalMapEntry'],true],['any',['in','places',['global-state','mapLayers']],['in','realms',['global-state','mapLayers']]]],['all',['==',['get','regionalEntry'],true],['global-state','gm'],['global-state','editing']]];
export const ordinaryPlaceVisible=['all',placeSeen,placeOnLayer,crossingVisible,['!=',['get','regionalMapEntry'],true]];

export function regionalMapEntryLayer({markerScale=1,labelScale=1}={}){
  return{id:'regional-map-entries',type:'symbol',source:'places',filter:['all',placeSeen,placeOnLayer,['==',['get','regionalMapEntry'],true]],layout:{
    'icon-image':['coalesce',['image',['get','icon']],['image','faerun-regional']],
    'icon-size':markerScale,'icon-allow-overlap':true,'icon-ignore-placement':false,'icon-padding':4,
    'text-field':['get','name'],'text-font':['Noto Sans Medium'],'text-size':17*labelScale,'text-anchor':'left','text-offset':[.9,0],'text-max-width':12,
    'text-optional':false,'text-allow-overlap':true,'text-ignore-placement':false,'text-padding':4,'symbol-sort-key':-1000
  },paint:{'text-color':'#fff3cf','text-halo-color':'#111111','text-halo-width':2,'icon-opacity':['case',['get','hidden'],.4,1],'text-opacity':['case',['get','hidden'],.4,1]}};
}
