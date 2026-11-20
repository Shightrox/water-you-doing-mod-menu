const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('src/mod/core.js', 'utf8');
function extract(name) {
  const start = source.indexOf('function '+name+'(');
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end);
}
let shift = false, focus = true;
const ctx = vm.createContext({
  config: {noclipSpeed: 10, open: false}, focused: () => focus,
  keyState: key => key === 0x10 && shift ? 0x8000 : 0,
  noclipBoatSetPose: () => {}, noclipBoatSync: () => {},
  noclipSetPosition: () => {}, noclipSync: () => {}, field: () => 0,
  cls: () => 'Movement', call: () => { throw Error('Unexpected mode change'); },
  noclipState: null
});
// Avoid importing initialization that touches the game. These are the actual
// movement functions from the distributed core, with only engine I/O stubbed.
for (const name of ['clampNoclipSpeed','noclipMultiplier']) vm.runInContext(source.split('\n').find(l=>l.startsWith('function '+name+'(')),ctx);
for (const name of ['noclipBoatHeading','noclipBoatMove','noclipMove']) vm.runInContext(extract(name),ctx);
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
assert.equal(ctx.clampNoclipSpeed(99),10);
assert.equal(ctx.clampNoclipSpeed(-1),0.5);
assert.equal(ctx.clampNoclipSpeed(NaN),1.5);
assert.equal(ctx.noclipMultiplier(),10);
shift=true;assert.equal(ctx.noclipMultiplier(),20);
focus=false;assert.equal(ctx.noclipMultiplier(),10);focus=true;
ctx.config.open=true;assert.equal(ctx.noclipMultiplier(),10);ctx.config.open=false;
const freshBoat = () => ({kind:'boat',baseSpeed:425,position:[0,0,0],rotation:[0,90,0]});
ctx.noclipState=freshBoat();ctx.noclipBoatMove(0,1,0,0.05);
assert.deepEqual(ctx.noclipState.position,[0,0,0]);close(ctx.noclipState.rotation[1],93);
ctx.noclipBoatMove(0,-1,0,0.05);close(ctx.noclipState.rotation[1],90);
ctx.noclipState=freshBoat();ctx.noclipBoatMove(1,0,0,0.05);
close(ctx.noclipState.position[0],425);close(ctx.noclipState.position[1],0);
ctx.noclipState=freshBoat();ctx.noclipBoatMove(-1,0,0,0.05);close(ctx.noclipState.position[0],-425);
ctx.noclipState=freshBoat();ctx.noclipBoatMove(1,0,1,0.5);
close(Math.hypot(...ctx.noclipState.position),425);
shift=false;ctx.noclipState=freshBoat();ctx.noclipBoatMove(1,0,0,0.05);close(ctx.noclipState.position[0],212.5);
// Independent reference: the game's SceneComponent.GetRightVector result from
// the live hull, including nonzero pitch and roll. BP_Boat negates this vector.
const measuredRotation=[0.018646097871333957,-87.8345063630626,1.0761057175645286];
const measuredRight=[0.9991098422932819,0.03777322467305122,-0.018780482701278592];
const measuredHeading=ctx.noclipBoatHeading(measuredRotation);
close(measuredHeading[0],-measuredRight[0]/Math.hypot(...measuredRight.slice(0,2)));
close(measuredHeading[1],-measuredRight[1]/Math.hypot(...measuredRight.slice(0,2)));
for(const [yaw,expected] of [[0,[0,-1]],[90,[1,0]],[180,[0,1]],[-90,[-1,0]]]) {
  const heading=ctx.noclipBoatHeading([0,yaw,0]);heading.forEach((n,i)=>close(n,expected[i]));
}
ctx.noclipState={baseSpeed:200,position:[0,0,0],movement:{add:()=>({readU8:()=>0})}};
shift=true;ctx.noclipMove([1,1,0],0.05);close(Math.hypot(...ctx.noclipState.position),200);
console.log('PASS: shared 0.5..10 clamp, Shift x2, focus/menu guard, boat yaw without strafe, hull-relative travel, normalized diagonal, frame-time cap, character boost');
