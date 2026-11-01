import { test } from "node:test";
import assert from "node:assert/strict";
import { primaryGM, isPrimaryGM, primaryGMChoices } from "../scripts/authority.mjs";

test("primary GM uses user-list order, an explicit selection, and connected fallback", () => {
  const a = { id:"a", name:"First", isGM:true, active:true }, b = { id:"b",name:"Second",isGM:true,active:true }, player={id:"p",isGM:false,active:true};
  let setting="";
  const game={users:[player,a,b],user:a,settings:{get:()=>setting}};
  assert.equal(primaryGM(game),a);
  setting="b";assert.equal(primaryGM(game),b);assert.equal(isPrimaryGM(game),false);
  game.user=b;assert.equal(isPrimaryGM(game),true);
  b.active=false;assert.equal(primaryGM(game),a);
  a.active=false;assert.equal(primaryGM(game),null);assert.equal(isPrimaryGM(game),false);
  assert.deepEqual(primaryGMChoices(game),{"":"Automatic: first connected GM in the user list",a:"First",b:"Second"});
});
