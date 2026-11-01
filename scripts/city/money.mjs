import {economyScale} from '../trade.mjs';
const VALUES={pp:1000,gp:100,ep:50,sp:10,cp:1};
export const BASE_FARE_CP=50; // 5 sp before the shared economy adjustment.
export const farePerRider = setting => Math.max(1,Math.ceil(BASE_FARE_CP*economyScale(setting)-1e-8));
export const walletValue = currency => Object.entries(VALUES).reduce((n,[key,value])=>n+Math.max(0,Math.floor(Number(currency?.[key])||0))*value,0);
/** A change detector, keeping full wallets out of the shared trip record. */
export async function walletFingerprint(currency){
  const text=JSON.stringify(Object.keys(VALUES).map(key=>Math.max(0,Math.floor(Number(currency?.[key])||0))));
  if(globalThis.crypto?.subtle){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');}
  let hash=2166136261;for(const c of text)hash=Math.imul(hash^c.charCodeAt(0),16777619);return (hash>>>0).toString(16);
}
export function payFare(currency,price){
  if(!Number.isSafeInteger(price)||price<0)throw Error('Invalid carriage fare.');
  const after=Object.fromEntries(Object.keys(VALUES).map(key=>[key,Math.max(0,Math.floor(Number(currency?.[key])||0))]));
  if(walletValue(after)<price)return null;
  let remaining=price;
  // Spend small coins first, breaking at most one larger coin. Fixed work even for large wallets.
  for(const key of ['cp','sp','ep','gp','pp']){const count=Math.min(after[key],Math.ceil(remaining/VALUES[key]));after[key]-=count;remaining-=count*VALUES[key];if(remaining<=0)break;}
  let change=-remaining;
  for(const key of ['pp','gp','sp','cp']){const count=Math.floor(change/VALUES[key]);after[key]+=count;change-=count*VALUES[key];}
  return after;
}
export function coinLabel(copper){if(!copper)return'Free';const parts=[];for(const [key,value]of [['pp',1000],['gp',100],['sp',10],['cp',1]]){const count=Math.floor(copper/value);if(count)parts.push(`${count} ${key}`);copper-=count*value;}return parts.join(' ');}
