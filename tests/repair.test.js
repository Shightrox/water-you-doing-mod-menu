const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('src/mod/core.js','utf8');
const repairSource=source.slice(source.indexOf('function repairTick(){'),source.indexOf('\nfunction ',source.indexOf('function repairTick(){')+1));
const obj=(id,kind)=>({id,kind,equals(other){return other&&other.id===id;}});
const character=obj('character','BP_WaterPlayerCharacter_C'),seat=obj('seat','BP_SteeringSeat_C'),controller=obj('controller','Controller'),boat=obj('boat','BP_Boat_C');
let calls=[],notices=[];
const ctx=vm.createContext({
  pawn:character,pc:controller,repairJob:null,Date:{now:()=>1000},
  noclipIdentity:()=>true,usableItem:()=>true,cls:o=>o.kind,noclipGameLocked:()=>false,
  readp:()=>controller,tr:s=>s,notify:s=>notices.push(s),call:(...args)=>{calls.push(args);throw Error('Simulated engine failure');},
  field:(c,n)=>n,log:()=>{}
});
vm.runInContext(repairSource,ctx);
function job(){return {character,controller,boat,targets:[{p:{add:n=>({readU8:()=>n==='bDestroyed'?1:2,readS32:()=>0})},attempts:0,last:-1,stalled:0}],next:0,done:0,failed:0};}
// A queued repair must abort before native dispatch when possession changes.
ctx.repairJob=job();ctx.pawn=seat;ctx.repairTick();assert.equal(ctx.repairJob,null);assert.equal(calls.length,0);
// Dismount/climb actions on the same character also cancel the job.
ctx.pawn=character;ctx.noclipGameLocked=()=>true;ctx.repairJob=job();ctx.repairTick();assert.equal(ctx.repairJob,null);assert.equal(calls.length,0);
// Losing the pinned controller cancels even if the character pointer survived.
ctx.noclipGameLocked=()=>false;ctx.pc=obj('other','Controller');ctx.repairJob=job();ctx.repairTick();assert.equal(ctx.repairJob,null);assert.equal(calls.length,0);
// A native failure must not leave a job that retries the dangerous operation.
ctx.pc=controller;ctx.cls=o=>o.kind||'BP_HealthPlateParent_C';ctx.repairJob=job();
assert.throws(()=>ctx.repairTick(),/Simulated engine failure/);assert.equal(ctx.repairJob,null);assert.equal(calls.length,1);assert.equal(calls[0][0],character);
console.log('PASS: repair aborts on seat possession, action lock and controller change; dispatch stays bound to original character; failure clears queue');
