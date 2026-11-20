// Water You Doing 1.0.6 — live, reversible HUD mod for the inspected Win64 build.
'use strict';
const base = Process.mainModule.base;
if (Process.mainModule.size !== 152158208) throw new Error('Unsupported executable build');
const blocks=base.add(0x863d7d0), arr=base.add(0x870b860), names={};
function fname(id){ if(names[id]!==undefined)return names[id]; try {const e=blocks.add((id>>>16)*8).readPointer().add((id&65535)*2),h=e.readU16(),n=h>>>6;if(n>1024)return'?';return names[id]=(h&1)?e.add(2).readUtf16String(n):e.add(2).readCString(n);}catch(e){return'?';}}
function name(p){if(!p||p.isNull())return'';const s=fname(p.add(24).readU32()),n=p.add(28).readU32();return s+(n?'_'+(n-1):'');}
function cls(p){return name(p.add(16).readPointer());}
function valid(p){try{if(!p||p.isNull())return false;const i=p.add(12).readU32();if(i>=arr.add(20).readU32())return false;return arr.readPointer().add((i>>>16)*8).readPointer().add((i&65535)*24+8).readPointer().equals(p)&&!(p.add(8).readU32()&0x8000);}catch(e){return false;}}
function each(cb){const chunks=arr.readPointer(),n=arr.add(20).readU32();for(let c=0;c<Math.ceil(n/65536);c++){const chunk=chunks.add(c*8).readPointer();if(chunk.isNull())continue;for(let j=0;j<Math.min(65536,n-c*65536);j++){const p=chunk.add(j*24+8).readPointer();if(!p.isNull())cb(p);}}}
function properties(p){const out=[];for(let f=p.add(0x50).readPointer(),i=0;!f.isNull()&&i<2000;i++,f=f.add(0x18).readPointer())out.push({p:f,name:fname(f.add(0x20).readU32()),off:f.add(0x44).readU32(),size:f.add(0x34).readU32(),type:fname(f.add(8).readPointer().readU32())});return out;}
const funcs={},classes={},tables={},defaults={};let font=ptr(0);
each(p=>{const c=cls(p),n=name(p);if(c==='Function')funcs[name(p.add(32).readPointer())+'.'+n]=p;else if(c==='Class'||c==='BlueprintGeneratedClass')classes[n]=p;else if(c==='DataTable')tables[n]=p;else if(n.startsWith('Default__'))defaults[n.substring(9)]=p;else if(c==='Font'&&n==='DefaultRegularFont')font=p;});
function fn(owner,n){const p=funcs[owner+'.'+n];if(!p)throw new Error('Missing function '+owner+'.'+n);return p;}
const dispatchers={},eventCompatibility={};
function assertEventTarget(obj,func){
  if(!valid(obj)||!valid(func))throw new Error('Reflected call target is no longer valid');
  const actual=obj.add(16).readPointer(),owner=func.add(32).readPointer(),key=actual.toString()+':'+owner.toString();
  let allowed=eventCompatibility[key];
  if(allowed===undefined){
    allowed=false;
    for(let c=actual,i=0;!c.isNull()&&i<64;c=c.add(0x40).readPointer(),i++)if(c.equals(owner)){allowed=true;break;}
    eventCompatibility[key]=allowed;
  }
  if(!allowed)throw new Error('Refused '+name(owner)+'.'+name(func)+' on '+name(actual));
}
function pe(obj,func,params){assertEventTarget(obj,func);const address=obj.readPointer().add(76*8).readPointer(),key=address.toString();let dispatch=dispatchers[key];if(!dispatch)dispatch=dispatchers[key]=new NativeFunction(address,'void',['pointer','pointer','pointer']);dispatch(obj,func,params);}
const pools={};
function call(obj,owner,n,fill){if(!valid(obj))throw new Error('Object unavailable: '+owner);const f=fn(owner,n),key=f.toString();let p=pools[key];if(!p)p=pools[key]=Memory.alloc(Math.max(128,f.add(0xb6).readU16()));p.writeByteArray(new Uint8Array(Math.max(128,f.add(0xb6).readU16())));if(fill)fill(p);pe(obj,f,p);return p;}
const fields={};
function field(c,n){const k=c+'.'+n;if(fields[k]!==undefined)return fields[k];let p=classes[c];while(p&&!p.isNull()){const f=properties(p).find(f=>f.name===n);if(f)return fields[k]=f.off;p=p.add(0x40).readPointer();}throw new Error('Missing property '+k);}
function readp(p,n){return p.add(field(cls(p),n)).readPointer();}
function readnum(p,n){return p.add(field(cls(p),n)).readDouble();}
function tableRows(t){const rows={};if(!t)return rows;const d=t.add(0x30).readPointer(),n=t.add(0x38).readU32();for(let i=0;i<n;i++){const e=d.add(i*24),v=e.add(8).readPointer();if(v.isNull())continue;const id=fname(e.readU32());rows[id]={key:e.readU64().toString(),row:v};}return rows;}
const items=tableRows(tables.DT_Pickables), fish=tableRows(tables.DT_FishInfo);
const config={lang:'en',open:false,tab:0,row:0,quick:false,big:false,keepFish:true,spawn:true,fish:0,fuel:false,noclip:true,noclipSpeed:1.5,monsterScale:10,rainCount:15};
function clampMonsterScale(value){return Math.max(2,Math.min(20,Math.round(Number(value)||10)));}
function clampRainCount(value){return Math.max(1,Math.min(100,Math.round(Number(value)||15)));}
function clampNoclipSpeed(value){const n=Number(value);return Number.isFinite(n)?Math.round(Math.max(0.5,Math.min(10,n))*10)/10:1.5;}
if(typeof INITIAL_CONFIG!=='undefined'){for(const k of ['quick','big','fuel'])config[k]=INITIAL_CONFIG[k]===true;for(const k of ['keepFish','spawn','noclip'])if(typeof INITIAL_CONFIG[k]==='boolean')config[k]=INITIAL_CONFIG[k];config.fish=Math.max(0,Math.min(CATALOG.fish.length,Number(INITIAL_CONFIG.fish)||0));config.noclipSpeed=clampNoclipSpeed(INITIAL_CONFIG.noclipSpeed);}
if(typeof INITIAL_CONFIG!=='undefined')config.monsterScale=clampMonsterScale(INITIAL_CONFIG.monsterScale);
if(typeof INITIAL_CONFIG!=='undefined')config.rainCount=clampRainCount(INITIAL_CONFIG.rainCount);
if(typeof INITIAL_CONFIG!=='undefined')config.lang=INITIAL_CONFIG.lang==='ru'?'ru':'en';
initCatalogLanguage();
let pc=ptr(0),pawn=ptr(0),hudNow=ptr(0),lastTick=0,lastStatus=0,stopped=false,lastError='',notice=tr('F8 — меню'),noticeUntil=0,heldLock=false;
let funJob=null,fishDisguise=null;
let boats=[],repairTargets=[],lastScan=0;
const queue=[],restores=new Map(),listeners=[];
function log(type,data){__send(JSON.stringify({type,...data}));}
function notify(s){notice=s;noticeUntil=Date.now()+6500;log('notice',{text:s});}
function ownPickup(){return valid(pawn)&&cls(pawn)==='BP_WaterPlayerCharacter_C'?pawn.add(1816).readPointer():ptr(0);}
function ownRods(){const p=ownPickup();if(!valid(p))return[];return [p.add(384).readPointer(),p.add(392).readPointer()].filter(valid);}
function ownHooks(){return ownRods().map(p=>p.add(896).readPointer()).filter(valid);}
function ownHook(p){return ownHooks().some(h=>h.equals(p));}
const protectedHooks=new Map();
function sameHook(r){return valid(r.p)&&r.p.add(12).readU32()===r.index&&r.p.add(28).readU32()===r.number;}
function castActive(h){return !h.add(913).readU8()&&(h.add(977).readU8()||h.add(912).readU8()||valid(h.add(904).readPointer()));}
function protectHook(h){if(!valid(h))return;const k=h.toString();let r=protectedHooks.get(k);if(r&&!sameHook(r)){protectedHooks.delete(k);r=null;}if(!config.keepFish){if(!r)return;if(!castActive(h)){h.add(900).writeU8(r.old);protectedHooks.delete(k);return;}}const old=h.add(900).readU8();if(!r&&old){r={p:h,index:h.add(12).readU32(),number:h.add(28).readU32(),old};protectedHooks.set(k,r);log('keep-fish',{hook:k,enabled:true});}if(r){if(old)r.old=old;h.add(900).writeU8(0);}}
function keepFishTick(){const owned=ownHooks();for(const [k,r]of protectedHooks){if(!sameHook(r)){protectedHooks.delete(k);continue;}if(!owned.some(h=>h.equals(r.p))||(!config.keepFish&&!castActive(r.p))){r.p.add(900).writeU8(r.old);protectedHooks.delete(k);}}for(const h of owned)protectHook(h);}
function restoreHooks(){for(const r of protectedHooks.values())if(sameHook(r))r.p.add(900).writeU8(r.old);protectedHooks.clear();}
function rememberDouble(p,off,value){const k=p+':'+off;if(!restores.has(k))restores.set(k,{p,i:p.add(12).readU32(),off,old:p.add(off).readDouble()});p.add(off).writeDouble(value);}
function restoreDoubles(){for(const r of restores.values())if(valid(r.p)&&r.p.add(12).readU32()===r.i)r.p.add(r.off).writeDouble(r.old);restores.clear();}
function scanActors(){boats=[];repairTargets=[];each(p=>{try{const n=name(p);if(n.startsWith('Default__')||n.includes('GEN_VARIABLE')||!valid(p))return;const c=cls(p);if(c==='BP_Boat_C')boats.push(p);if(/BP_HealthPlate|BP_HealthHole|BP_Propeller|BP_Harpoon/.test(c))repairTargets.push(p);}catch(e){}});lastScan=Date.now();}
function location(p){return call(p,'Actor','K2_GetActorLocation');}
function nearestBoat(){if(Date.now()-lastScan>6000)scanActors();const list=boats.filter(valid);if(!list.length)return ptr(0);if(list.length===1)return list[0];const a=location(pawn),x=a.readDouble(),y=a.add(8).readDouble(),z=a.add(16).readDouble();let best=list[0],d=Infinity;for(const p of list){const b=location(p),v=(b.readDouble()-x)**2+(b.add(8).readDouble()-y)**2+(b.add(16).readDouble()-z)**2;if(v<d){d=v;best=p;}}return best;}
function usableItem(p){return valid(p)&&call(defaults.KismetSystemLibrary,'KismetSystemLibrary','IsValid',b=>b.writePointer(p)).add(8).readU8()!==0;}
// Noclip uses the game's owned server transform RPC, not a client-only camera.
// The movement component is paused only while C is held; collision and input
// are restored on release, menu opening, focus loss, pawn change and unload.
let noclipState=null,noclipWasDown=false;
function noclipMultiplier(){return clampNoclipSpeed(config.noclipSpeed)*(!config.open&&focused()&&(keyState(0x10)&0x8000)?2:1);}
function noclipIdentity(p,index,number){return valid(p)&&p.add(12).readU32()===index&&p.add(28).readU32()===number;}
function noclipGameLocked(p){return p.add(2120).readU8()||p.add(2364).readU8()||usableItem(p.add(2352).readPointer())||usableItem(p.add(1856).readPointer());}
function noclipVector(p){return [0,8,16].map(o=>p.add(o).readDouble());}
function noclipSetPosition(s){call(s.pawn,'Actor','K2_SetActorLocation',p=>{s.position.forEach((n,i)=>p.add(i*8).writeDouble(n));p.add(288).writeU8(1);});}
function noclipSync(s,force){
  const now=Date.now(),changed=s.position.some((v,i)=>Math.abs(v-s.sent[i])>0.1);
  if(!force&&(now-s.lastSync<50||(!changed&&now-s.lastSync<250)))return;
  if(s.pawn.add(360).readU8()===2){
    // bServer=false selects the host's no-sweep teleport branch. true skips it.
    call(s.pawn,'BP_WaterPlayerCharacter_C','Server_UpdatePlayerTransform',p=>{
      p.writeU8(0);s.position.forEach((n,i)=>p.add(8+i*8).writeDouble(n));
    });
  }
  s.lastSync=now;s.sent=s.position.slice();
}
function noclipBegin(){
  if(noclipState)return true;
  if(!usableItem(pawn)||!valid(pc))return false;
  if(cls(pawn)==='BP_SteeringSeat_C')return noclipBoatBegin();
  if(cls(pawn)!=='BP_WaterPlayerCharacter_C'){notify(tr('Для noclip встань с места и вернись к персонажу'));return false;}
  const m=readp(pawn,'CharacterMovement');if(!usableItem(m))return false;
  if(noclipGameLocked(pawn)){notify(tr('Сначала выйди из кресла, гарпуна или закончи подъём'));return false;}
  const mode=m.add(field(cls(m),'MovementMode')).readU8();
  if(mode===0||mode===6||call(pc,'Controller','IsMoveInputIgnored').readU8()){notify(tr('Noclip недоступен во время текущего действия'));return false;}
  const speed=readnum(pawn,'WalkSpeed');
  const s={pawn,pawnIndex:pawn.add(12).readU32(),pawnNumber:pawn.add(28).readU32(),pc,pcIndex:pc.add(12).readU32(),pcNumber:pc.add(28).readU32(),movement:m,mIndex:m.add(12).readU32(),mNumber:m.add(28).readU32(),mode,custom:m.add(field(cls(m),'CustomMovementMode')).readU8(),swimming:!!pawn.add(1872).readU8(),collision:!!call(pawn,'Actor','GetActorEnableCollision').readU8(),tick:!!call(m,'ActorComponent','IsComponentTickEnabled').readU8(),inputLocked:false,baseSpeed:Number.isFinite(speed)&&speed>0?speed:200,position:noclipVector(location(pawn)),sent:[NaN,NaN,NaN],lastSync:0,lastFrame:Date.now()};
  noclipState=s;
  try{
    call(pc,'Controller','SetIgnoreMoveInput',p=>p.writeU8(1));s.inputLocked=true;
    call(pawn,'Pawn','ConsumeMovementInputVector');
    call(m,'MovementComponent','StopMovementImmediately');
    call(m,'CharacterMovementComponent','SetMovementMode',p=>p.writeU8(0));
    call(m,'ActorComponent','SetComponentTickEnabled',p=>p.writeU8(0));
    call(pawn,'Actor','SetActorEnableCollision',p=>p.writeU8(0));
    noclipSync(s,true);
    log('noclip-start',{pawn:s.pawn.toString(),role:s.pawn.add(360).readU8(),baseSpeed:s.baseSpeed,multiplier:config.noclipSpeed,position:s.position});
    return true;
  }catch(e){noclipEnd('error');throw e;}
}
function noclipEnd(reason){
  const s=noclipState;if(!s)return;
  if(s.kind==='boat'){noclipBoatEnd(reason);return;}
  noclipState=null;
  const errors=[],attempt=f=>{try{f();}catch(e){errors.push(String(e));}};
  const samePawn=noclipIdentity(s.pawn,s.pawnIndex,s.pawnNumber),sameMovement=noclipIdentity(s.movement,s.mIndex,s.mNumber);
  const gameLocked=samePawn&&noclipGameLocked(s.pawn);
  if(samePawn){
    if(!gameLocked&&pawn.equals(s.pawn)&&pc.equals(s.pc)&&reason!=='error'&&reason!=='controller-lost')attempt(()=>noclipSync(s,true));
    if(!gameLocked)attempt(()=>call(s.pawn,'Actor','SetActorEnableCollision',p=>p.writeU8(s.collision?1:0)));
  }
  if(sameMovement){
    attempt(()=>call(s.movement,'MovementComponent','StopMovementImmediately'));
    if(samePawn){
      attempt(()=>call(s.pawn,'Pawn','ConsumeMovementInputVector'));
      // Swimming is tracked by gameplay while flying across water. Respect its
      // current state rather than restoring a stale land/water movement mode.
      const swimming=!!s.pawn.add(1872).readU8(),mode=swimming?5:s.swimming?1:s.mode;
      if(!gameLocked)attempt(()=>call(s.movement,'CharacterMovementComponent','SetMovementMode',p=>{p.writeU8(mode);p.add(1).writeU8(mode===s.mode?s.custom:0);}));
    }
    attempt(()=>call(s.movement,'ActorComponent','SetComponentTickEnabled',p=>p.writeU8(s.tick?1:0)));
  }
  if(s.inputLocked&&noclipIdentity(s.pc,s.pcIndex,s.pcNumber))attempt(()=>call(s.pc,'Controller','SetIgnoreMoveInput',p=>p.writeU8(0)));
  log('noclip-stop',{reason:reason||'released',position:s.position,restored:!errors.length,errors});
  if(errors.length)notify(tr('Не удалось полностью восстановить движение: ')+errors[0]);
}
function noclipMove(direction,dt){
  const s=noclipState;if(!s)return;
  const length=Math.hypot(...direction),speed=s.baseSpeed*noclipMultiplier();
  if(length>0)for(let i=0;i<3;i++)s.position[i]+=direction[i]/length*speed*Math.max(0,Math.min(0.05,dt));
  if(s.movement.add(field(cls(s.movement),'MovementMode')).readU8()!==0)call(s.movement,'CharacterMovementComponent','SetMovementMode',p=>p.writeU8(0));
  noclipSetPosition(s);noclipSync(s,false);
}
function noclipFrame(now){
  const down=(keyState(0x43)&0x8000)!==0,edge=down&&!noclipWasDown;noclipWasDown=down;
  const flyInput=((down&&config.noclip)||!!fishDisguise)&&!config.open&&focused()&&valid(pc)&&!pc.add(2193).readU8();
  const allowed=flyInput||!!fishDisguise;
  if(noclipState&&(!allowed||!pawn.equals(noclipState.pawn)||!noclipIdentity(noclipState.pawn,noclipState.pawnIndex,noclipState.pawnNumber)||!noclipIdentity(noclipState.movement,noclipState.mIndex,noclipState.mNumber))){noclipEnd(!allowed?'released':'pawn-changed');return;}
  if(noclipState&&noclipState.kind==='boat'&&!noclipBoatValid(noclipState)){noclipEnd('boat-changed');return;}
  if(noclipState&&noclipState.kind!=='boat'&&noclipGameLocked(noclipState.pawn)){if(fishDisguise)setFishDisguise(false);noclipEnd('game-action');return;}
  if(!noclipState){if(!allowed||!edge||!noclipBegin())return;}
  const s=noclipState,dt=(now-s.lastFrame)/1000;s.lastFrame=now;
  const pressed=k=>flyInput&&(keyState(k)&0x8000)!==0?1:0;
  const forward=pressed(0x57)-pressed(0x53),right=pressed(0x44)-pressed(0x41),up=pressed(0x20)-pressed(0x11);
  if(s.kind==='boat'){noclipBoatMove(forward,right,up,dt);return;}
  const rotation=call(pc,'Controller','GetControlRotation'),pitch=rotation.readDouble()*Math.PI/180,yaw=rotation.add(8).readDouble()*Math.PI/180;
  noclipMove([forward*Math.cos(pitch)*Math.cos(yaw)-right*Math.sin(yaw),forward*Math.cos(pitch)*Math.sin(yaw)+right*Math.cos(yaw),forward*Math.sin(pitch)+up],dt);
}
// The same C input routes a possessed steering seat to the host's boat body.
// Keep deck collision intact: disable rigid-body simulation, then teleport the
// root without a sweep. Existing seat and movement-base attachments carry riders.
function noclipBoatValid(s){
  return noclipIdentity(s.boat,s.boatIndex,s.boatNumber)&&s.boat.add(360).readU8()===3&&
    noclipIdentity(s.pawn,s.pawnIndex,s.pawnNumber)&&readp(s.pawn,'BP_Boat').equals(s.boat)&&
    readp(s.boat,'BoatPhysicsMesh').equals(s.movement)&&readp(s.pawn,'Controller').equals(s.pc);
}
function noclipBoatBegin(){
  if(!valid(pawn)||cls(pawn)!=='BP_SteeringSeat_C'||!readp(pawn,'Controller').equals(pc))return false;
  const boat=readp(pawn,'BP_Boat');if(!usableItem(boat)||cls(boat)!=='BP_Boat_C')return false;
  if(boat.add(360).readU8()!==3){notify(tr('Полёт лодки доступен у хоста'));return false;}
  if(typeof __setInputGate!=='function'){notify(tr('Для полёта лодки запусти автономный BAT'));return false;}
  const root=readp(boat,'BoatPhysicsMesh'),buoyancy=readp(boat,'Buoyancy'),sync=readp(boat,'SmoothSync');
  if(!usableItem(root)||!readp(boat,'RootComponent').equals(root)){notify(tr('Физика лодки ещё не готова'));return false;}
  if(call(pc,'Controller','IsMoveInputIgnored').readU8()){notify(tr('Noclip недоступен во время текущего действия'));return false;}
  const maxSpeed=readnum(boat,'MaxSpeed');
  const s={kind:'boat',pawn,pawnIndex:pawn.add(12).readU32(),pawnNumber:pawn.add(28).readU32(),
    pc,pcIndex:pc.add(12).readU32(),pcNumber:pc.add(28).readU32(),boat,boatIndex:boat.add(12).readU32(),boatNumber:boat.add(28).readU32(),
    movement:root,mIndex:root.add(12).readU32(),mNumber:root.add(28).readU32(),
    buoyancy,buoyancyIndex:valid(buoyancy)?buoyancy.add(12).readU32():-1,buoyancyNumber:valid(buoyancy)?buoyancy.add(28).readU32():-1,
    sync,syncIndex:valid(sync)?sync.add(12).readU32():-1,syncNumber:valid(sync)?sync.add(28).readU32():-1,
    simulation:!!call(root,'SceneComponent','IsSimulatingPhysics').add(8).readU8(),
    boatTick:!!call(boat,'Actor','IsActorTickEnabled').readU8(),buoyancyTick:valid(buoyancy)&&!!call(buoyancy,'ActorComponent','IsComponentTickEnabled').readU8(),
    baseSpeed:Number.isFinite(maxSpeed)&&maxSpeed>0?maxSpeed:425,
    position:noclipVector(location(boat)),rotation:noclipVector(call(boat,'Actor','K2_GetActorRotation')),
    sent:[NaN,NaN,NaN],sentYaw:NaN,lastSync:0,lastFrame:Date.now(),inputLocked:false,seatInputGated:false};
  noclipState=s;
  try{
    call(pc,'Controller','SetIgnoreMoveInput',p=>p.writeU8(1));s.inputLocked=true;
    // Keep the inherited IA_Look event live, with the game's normal sensitivity.
    // Only this local seat's steering/engine/action events are suppressed.
    const actions=Object.keys(funcs).filter(n=>n.startsWith('BP_SteeringSeat_C.InpActEvt_')&&!n.includes('IA_Look_')).map(n=>BigInt(funcs[n].toString()));
    if(!actions.length)throw new Error('Steering input events are unavailable');
    __setInputGate(BigInt(s.pawn.toString()),actions);s.seatInputGated=true;
    call(boat,'Actor','SetActorTickEnabled',p=>p.writeU8(0));
    if(usableItem(buoyancy))call(buoyancy,'ActorComponent','SetComponentTickEnabled',p=>p.writeU8(0));
    call(root,'PrimitiveComponent','SetPhysicsLinearVelocity');
    call(root,'PrimitiveComponent','SetPhysicsAngularVelocityInDegrees');
    call(root,'PrimitiveComponent','SetSimulatePhysics',p=>p.writeU8(0));
    noclipBoatSync(s,true);
    log('noclip-start',{kind:'boat',boat:boat.toString(),baseSpeed:s.baseSpeed,multiplier:config.noclipSpeed,position:s.position});
    return true;
  }catch(e){noclipEnd('error');throw e;}
}
function noclipBoatSync(s,force){
  const now=Date.now(),changed=s.position.some((v,i)=>Math.abs(v-s.sent[i])>0.1)||Math.abs(s.rotation[1]-s.sentYaw)>0.05;
  if(!force&&(now-s.lastSync<50||(!changed&&now-s.lastSync<250)))return;
  if(noclipIdentity(s.sync,s.syncIndex,s.syncNumber)){
    call(s.sync,'SmoothSync','Teleport');
    call(s.sync,'SmoothSync','forceStateSendNextFrame');
  }
  call(s.boat,'Actor','ForceNetUpdate');
  s.lastSync=now;s.sent=s.position.slice();s.sentYaw=s.rotation[1];
}
function noclipBoatSetPose(s){
  call(s.boat,'Actor','K2_SetActorLocationAndRotation',p=>{
    s.position.forEach((n,i)=>p.add(i*8).writeDouble(n));
    s.rotation.forEach((n,i)=>p.add(24+i*8).writeDouble(n));p.add(312).writeU8(1);
  });
}
function noclipBoatHeading(rotation){
  // BP_Boat drives along -BoatPhysicsMesh.GetRightVector(), flattened to XY.
  // Its bow is local -Y, not the actor's conventional +X forward axis.
  const pitch=rotation[0]*Math.PI/180,yaw=rotation[1]*Math.PI/180,roll=rotation[2]*Math.PI/180;
  const x=Math.cos(roll)*Math.sin(yaw)-Math.sin(roll)*Math.sin(pitch)*Math.cos(yaw);
  const y=-Math.cos(roll)*Math.cos(yaw)-Math.sin(roll)*Math.sin(pitch)*Math.sin(yaw);
  const length=Math.hypot(x,y);
  return length>1e-6?[x/length,y/length]:[Math.sin(yaw),-Math.cos(yaw)];
}
function noclipBoatMove(forward,turn,up,dt){
  const s=noclipState;if(!s||s.kind!=='boat')return;
  const step=Math.max(0,Math.min(0.05,dt));
  // A/D is hull yaw, never lateral translation. Boost does not amplify turning.
  s.rotation[1]=((s.rotation[1]+turn*60*step+540)%360)-180;
  const heading=noclipBoatHeading(s.rotation),length=Math.hypot(forward,up),speed=s.baseSpeed*noclipMultiplier();
  if(length){s.position[0]+=forward/length*heading[0]*speed*step;s.position[1]+=forward/length*heading[1]*speed*step;s.position[2]+=up/length*speed*step;}
  noclipBoatSetPose(s);noclipBoatSync(s,false);
}
function noclipBoatEnd(reason){
  const s=noclipState;if(!s||s.kind!=='boat')return;noclipState=null;
  const errors=[],attempt=f=>{try{f();}catch(e){errors.push(String(e));}};
  const sameBoat=noclipIdentity(s.boat,s.boatIndex,s.boatNumber),sameRoot=noclipIdentity(s.movement,s.mIndex,s.mNumber);
  if(sameRoot){
    // Resume at rest; old momentum must not fling the boat after a long flight.
    attempt(()=>call(s.movement,'PrimitiveComponent','SetSimulatePhysics',p=>p.writeU8(s.simulation?1:0)));
    if(s.simulation){attempt(()=>call(s.movement,'PrimitiveComponent','SetPhysicsLinearVelocity'));attempt(()=>call(s.movement,'PrimitiveComponent','SetPhysicsAngularVelocityInDegrees'));}
  }
  if(noclipIdentity(s.buoyancy,s.buoyancyIndex,s.buoyancyNumber))attempt(()=>call(s.buoyancy,'ActorComponent','SetComponentTickEnabled',p=>p.writeU8(s.buoyancyTick?1:0)));
  if(sameBoat){attempt(()=>call(s.boat,'Actor','SetActorTickEnabled',p=>p.writeU8(s.boatTick?1:0)));attempt(()=>noclipBoatSync(s,true));}
  if(s.seatInputGated)attempt(()=>__setInputGate(0n,[]));
  if(s.inputLocked&&noclipIdentity(s.pc,s.pcIndex,s.pcNumber))attempt(()=>call(s.pc,'Controller','SetIgnoreMoveInput',p=>p.writeU8(0)));
  log('noclip-stop',{kind:'boat',reason:reason||'released',position:s.position,restored:!errors.length,errors});
  if(errors.length)notify(tr('Не удалось полностью восстановить движение: ')+errors[0]);
}
function heldItem(){const p=ownPickup();if(!valid(p))return ptr(0);for(const off of [208,376]){const h=p.add(off).readPointer();if(usableItem(h))return h;}const h=call(p,'BP_PickupComponent_C','GetCurrentItem').readPointer();return usableItem(h)?h:ptr(0);}
function heldLabel(h){try{const id=fname(h.add(field(cls(h),'ItemId')).readU32());return CATALOG.entries.find(e=>e.id===id)?.label||tr('предмет');}catch(_){return tr('предмет');}}
let spawnJob=null,materialJob=null;
function itemId(h){try{return fname(h.add(field(cls(h),'ItemId')).readU32());}catch(_){return '';}}
function finishSpawn(message,success,actor){const j=spawnJob;if(j){j.finished=true;j.success=!!success;j.message=message;j.actor=actor||j.actor;if(message&&!j.quiet)notify(message);}spawnJob=null;}
function issue(id,amount,options){
  options=options||{};const world=options.world===undefined?config.spawn:options.world;
  if(materialJob&&!options.material)return notify(tr('Сначала заверши или останови пополнение материалов'));
  if(funJob&&!options.fun)return notify(tr('Сначала заверши прикол'));
  if(usableItem(caughtFish()))return notify(tr('Сначала положи улов кнопкой в разделе «Приколы»'));
  const data=items[id];if(!data)throw new Error('Unknown item '+id);
  if(spawnJob)return notify(tr('Дождись создания предыдущего предмета'));
  const p=ownPickup();if(!valid(p))return notify(tr('Персонаж ещё не готов'));
  const held=heldItem();
  if(usableItem(held)){log('issue-blocked',{held:name(held),p:held.toString(),hidden:p.add(245).readU8(),raw:[208,376].map(o=>p.add(o).readPointer().toString())});return notify(tr('Рука занята: ')+heldLabel(held)+tr('. Сначала положи предмет'));}
  if(p.add(244).readU8()||p.add(245).readU8()||p.add(401).readU8()||p.add(402).readU8())return notify(tr('Заверши текущее действие персонажа'));
  // CustomFloat is price for a fish, not its mesh scale. -1 lets the game calculate it.
  let scale=amount||1;if(fish[id])scale=-1;
  const label=CATALOG.entries.find(e=>e.id===id)?.label||id;
  spawnJob={id,label,p,index:p.add(12).readU32(),pawn,pawnIndex:pawn.add(12).readU32(),mode:world?'world':'hand',material:!!options.material,quiet:!!options.quiet,fun:!!options.fun,continueAfterMenuClose:!!options.fun,phase:'wait-item',deadline:Date.now()+8000,menuWasOpen:config.open};
  try{call(p,'BP_PickupComponent_C','Server_ExchangeItem',b=>{b.writeU64(uint64(data.key));b.add(8).writeDouble(scale);b.add(16).writeDouble(0);});}
  catch(e){spawnJob=null;throw e;}
  if(!options.material&&!options.quiet)notify((world?tr('Создаю перед собой: '):tr('Выдаю в руку: '))+label);
  log('issue',{id,amount:scale,component:p.toString(),mode:spawnJob.mode});
}
function cancelMaterials(message){
  const j=materialJob;materialJob=null;
  if(spawnJob&&spawnJob.material){spawnJob.mode='hand';spawnJob.material=false;}
  if(j)notify(message||(tr('Пополнение остановлено: ')+j.done+tr(' из ')+j.total));
}
function addMaterials(id,count){
  if(id!=='Wood'&&id!=='Metal')return;
  if(materialJob||spawnJob||funJob||fishDisguise)return notify(tr('Дождись завершения текущего действия'));
  const pickup=ownPickup();if(!valid(pickup))return notify(tr('Персонаж ещё не готов'));
  const held=heldItem();if(usableItem(held))return notify(tr('Для пополнения нужна пустая рука: сейчас ')+heldLabel(held));
  const boat=nearestBoat();if(!valid(boat))return notify(tr('Лодка не найдена'));
  const storage=readp(readp(boat,id==='Wood'?'WoodStorage':'MetalStorage'),'ChildActor');
  if(!usableItem(storage)||itemId(storage)!==id)return notify(tr('Ящик материалов не найден'));
  const total=Math.max(1,Math.min(100,Math.floor(count)||1));
  materialJob={id,total,done:0,started:Date.now(),pawn,pawnIndex:pawn.add(12).readU32(),pickup,pickupIndex:pickup.add(12).readU32(),storage,index:storage.add(12).readU32(),number:storage.add(28).readU32(),phase:'start',deadline:Date.now()+15000};
  notify(tr('Пополняю ')+(id==='Wood'?tr('дерево'):tr('металл'))+': 0/'+total);
}
function materialTick(){
  const j=materialJob;if(!j)return;
  if(!valid(pawn)||!pawn.equals(j.pawn)||pawn.add(12).readU32()!==j.pawnIndex||!valid(j.pickup)||j.pickup.add(12).readU32()!==j.pickupIndex||!ownPickup().equals(j.pickup)||!usableItem(j.storage)||j.storage.add(12).readU32()!==j.index||j.storage.add(28).readU32()!==j.number)return cancelMaterials(tr('Пополнение остановлено: персонаж или лодка сменились'));
  if(Date.now()>j.deadline)return cancelMaterials(tr('Нет подтверждения от склада. Добавлено: ')+j.done+'/'+j.total);
  if(j.phase==='start'){
    if(spawnJob)return;
    if(usableItem(heldItem()))return cancelMaterials(tr('Пополнение остановлено: рука занята'));
    j.actor=null;j.issueAt=Date.now();issue(j.id,1,{world:false,material:true});
    if(!spawnJob)return cancelMaterials(tr('Не удалось создать материал; добавлено ')+j.done+'/'+j.total);
    j.request=spawnJob;j.phase='spawn';j.deadline=Date.now()+10000;return;
  }
  if(j.phase==='spawn'){
    if(spawnJob)return;
    if(!usableItem(j.actor)||j.actor.add(12).readU32()!==j.actorIndex||j.actor.add(28).readU32()!==j.actorNumber||itemId(j.actor)!==j.id)return cancelMaterials(tr('Выдача материала не подтверждена; добавлено ')+j.done+'/'+j.total);
    if(!j.pickup.add(208).readPointer().equals(j.actor))return cancelMaterials(tr('Предмет в руке изменился; пополнение остановлено'));
    const interaction=pc.add(1968).readPointer();
    if(!valid(interaction)||cls(interaction)!=='BP_InteractionComponent_C')return cancelMaterials(tr('Взаимодействие персонажа недоступно'));
    // The normal scrap pickup deposits into the host's storage and destroys this
    // exact actor. It works while held: no DropItem, physics or menu-open state.
    j.before=j.storage.add(736).readS32();
    const loc=location(j.actor),v=[0,8,16].map(o=>loc.add(o).readDouble());
    call(interaction,'BP_InteractionComponent_C','Server_Interact',p=>{p.writeU8(2);p.add(8).writePointer(j.actor);p.add(16).writeU8(1);v.forEach((n,i)=>p.add(24+i*8).writeDouble(n));});
    j.phase='confirm';j.deadline=Date.now()+5000;return;
  }
  if(j.phase==='confirm'&&!usableItem(j.actor)&&j.storage.add(736).readS32()>j.before){
    // Client-only RemoveItem clears the dead replicated hand reference. Never
    // use DeleteItem here: that graph also deletes the player's fishing rod.
    if(!isHost()&&j.pickup.add(208).readPointer().equals(j.actor))call(j.pickup,'BP_PickupComponent_C','RemoveItem');
    j.done++;log('materials-added',{id:j.id,done:j.done,total:j.total,count:j.storage.add(736).readS32(),route:'held-pickup',readyMs:j.readyAt-j.issueAt,elapsedMs:Date.now()-j.issueAt});
    if(usableItem(heldItem()))return cancelMaterials(tr('Добавлено ')+j.done+'/'+j.total+tr('; рука занята, пополнение остановлено'));
    if(j.done>=j.total){materialJob=null;log('materials-complete',{id:j.id,count:j.done,elapsedMs:Date.now()-j.started});notify((j.id==='Wood'?tr('Дерево'):tr('Металл'))+tr(': добавлено ')+j.done+tr(' в запас лодки'));return;}
    j.phase='start';j.deadline=Date.now()+15000;
    // Start the next unit now; the RPC result is still awaited asynchronously.
    materialTick();
  }
}
function spawnTick(){
  const j=spawnJob;if(!j)return;
  if(!valid(j.p)||j.p.add(12).readU32()!==j.index||!valid(j.pawn)||j.pawn.add(12).readU32()!==j.pawnIndex||!pawn.equals(j.pawn)||!ownPickup().equals(j.p))return finishSpawn(tr('Создание остановлено: персонаж сменился'));
  if(Date.now()>j.deadline)return finishSpawn(j.phase==='wait-item'?tr('Сервер не подтвердил выдачу. Попробуй ещё раз'):tr('Бросок не подтвердился; проверь предмет в руке'));
  if(j.phase==='wait-item'){
    const h=j.p.add(208).readPointer();if(!usableItem(h))return;
    if(itemId(h)!==j.id)return finishSpawn(tr('В руке появился другой предмет; действие остановлено'));
    if(j.mode==='hand'){
      if(j.material&&materialJob&&materialJob.request===j){
        materialJob.actor=h;materialJob.actorIndex=h.add(12).readU32();materialJob.actorNumber=h.add(28).readU32();materialJob.readyAt=Date.now();
        return finishSpawn(null,true,h);
      }
      return finishSpawn(tr('Выдано: ')+(CATALOG.entries.find(e=>e.id===j.id)?.label||j.label),true,h);
    }
    // A menu close may let the player pick up or manipulate another item.
    // Stop automatic input at that boundary instead of fighting their action.
    if(j.menuWasOpen&&!config.open&&!j.continueAfterMenuClose)return finishSpawn(tr('Предмет выдан в руку: меню было закрыто'),true,h);
    if(j.p.add(244).readU8()||j.p.add(245).readU8()||j.p.add(401).readU8()||j.p.add(402).readU8())return;
    const visible=call(j.p,'BP_PickupComponent_C','GetCurrentItem').readPointer();
    if(!usableItem(visible)||!visible.equals(h))return;
    j.actor=h;j.actorIndex=h.add(12).readU32();j.actorNumber=h.add(28).readU32();
    call(j.p,'BP_PickupComponent_C','DropItem');
    j.phase='wait-drop';j.deadline=Date.now()+5000;
    return;
  }
  if(j.phase==='wait-drop'){
    if(j.p.add(208).readPointer().equals(j.actor)||usableItem(heldItem()))return;
    const alive=usableItem(j.actor)&&j.actor.add(12).readU32()===j.actorIndex&&j.actor.add(28).readU32()===j.actorNumber;
    log('world-spawn',{id:j.id,actor:j.actor.toString(),alive,handEmpty:true});
    finishSpawn(alive?tr('Выкинут: ')+(CATALOG.entries.find(e=>e.id===j.id)?.label||j.label):tr('Предмет создан и уже забран или удалён'),alive,j.actor);
  }
}
// Fish use the game's separate replicated catch slot. Their size is supplied
// to Server_PickupFish, never stored in ItemData.CustomFloat (that is price).
function caughtFish(){if(!valid(pawn)||cls(pawn)!=='BP_WaterPlayerCharacter_C')return ptr(0);const f=pawn.add(1744).readPointer();return valid(f)?readp(f,'PickupFishActor'):ptr(0);}
function funReady(allowTool){
  if(funJob||spawnJob||materialJob||fishDisguise){notify(tr('Сначала заверши текущее действие или верни обычный облик'));return false;}
  if(!valid(pawn)||cls(pawn)!=='BP_WaterPlayerCharacter_C'||noclipGameLocked(pawn)){notify(tr('Сначала встань и вернись к управлению персонажем'));return false;}
  if((!allowTool&&usableItem(heldItem()))||usableItem(caughtFish())){notify(tr('Для этого действия нужна пустая рука'));return false;}
  if(allowTool&&ownHooks().some(castActive)){notify(tr('Сначала закончи текущий заброс'));return false;}
  return true;
}
function chosenMonsterId(){return config.fish>0?CATALOG.fish[config.fish-1].id:'FISH_Catfish';}
function spawnMonsterFish(disguise){
  if(!funReady(!!disguise))return;
  const f=pawn.add(1744).readPointer();if(!valid(f))return notify(tr('Рыбалка ещё не готова'));
  if(usableItem(readp(f,'PickupFishActorClientProxy')))return notify(tr('Сначала положи предыдущий улов'));
  const id=chosenMonsterId(),scale=fish[id].row.add(48).readDouble()*config.monsterScale;
  funJob={type:disguise?'disguise':'monster',phase:'fish',done:0,total:1,pawn,index:pawn.add(12).readU32(),number:pawn.add(28).readU32(),f,id,scale,deadline:Date.now()+8000};
  call(f,'BP_FishingComponent_C','Server_PickupFish',p=>{p.writeU64(uint64(items[id].key));p.add(8).writeDouble(-1);p.add(24).writeDouble(scale);});
  notify(tr('Создаю: ')+(CATALOG.entries.find(e=>e.id===id)?.label||tr('рыба'))+' ×'+config.monsterScale);
}
function applyFishDisguise(a){
  if(!usableItem(a)||!caughtFish().equals(a))return notify(tr('Улов больше не находится в руках'));
  if(!noclipBegin())return;
  const mesh=readp(a,'Mesh'),pickup=ownPickup();
  const s={pawn,index:pawn.add(12).readU32(),number:pawn.add(28).readU32(),pickup,pickupIndex:pickup.add(12).readU32(),pickupNumber:pickup.add(28).readU32(),actor:a,actorIndex:a.add(12).readU32(),actorNumber:a.add(28).readU32(),mesh,meshIndex:mesh.add(12).readU32(),meshNumber:mesh.add(28).readU32(),meshVisible:!!call(mesh,'SceneComponent','IsVisible').readU8(),visible:!!pawn.add(2648).readU8(),since:Date.now()};
  s.meshes=[mesh,readp(a,'SkeletalMesh')].filter((m,i,list)=>valid(m)&&list.findIndex(x=>x.equals(m))===i).map(m=>({p:m,index:m.add(12).readU32(),number:m.add(28).readU32(),visible:!!call(m,'SceneComponent','IsVisible').readU8()}));
  fishDisguise=s;
  try{
    // Remove the catch from gameplay lookup without detaching/destroying its
    // actor. The cosmetic model stays on FishSlot; normal tools keep working.
    call(pawn.add(1744).readPointer(),'BP_FishingComponent_C','Client_RemovePickupFishActor');
    for(const m of s.meshes)call(m.p,'SceneComponent','SetVisibility',p=>p.writeU8(0));
    call(pawn,'BP_WaterPlayerCharacter_C','Server_ToggleCharacterVisibility',p=>p.writeU8(0));
    // Apply locally immediately; the owned server RPC replicates the same flag.
    pawn.add(2648).writeU8(0);call(pawn,'BP_WaterPlayerCharacter_C','OnRep_bCharacterVisible');
    log('fish-disguise',{enabled:true,actor:a.toString(),scale:noclipVector(call(a,'Actor','GetActorScale3D'))});
    notify(tr('Ты — огромная рыба. WASD — полёт, Space/Ctrl — вверх/вниз. Можно брать инструменты'));
  }catch(e){setFishDisguise(false);throw e;}
}
function setFishDisguise(on){
  if(on){if(fishDisguise)return;const a=caughtFish();if(usableItem(a)&&!funJob&&!spawnJob&&!materialJob)return applyFishDisguise(a);return spawnMonsterFish(true);}
  const s=fishDisguise;fishDisguise=null;
  if(funJob?.type==='disguise')funJob=null;
  if(!s)return;
  const meshes=s.meshes||[{p:s.mesh,index:s.meshIndex,number:s.meshNumber,visible:s.meshVisible}];
  for(const m of meshes)if(noclipIdentity(m.p,m.index,m.number))try{call(m.p,'SceneComponent','SetVisibility',p=>p.writeU8(m.visible?1:0));}catch(e){log('error',{where:'restore-fish-mesh',message:String(e)});}
  if(noclipIdentity(s.actor,s.actorIndex,s.actorNumber)&&usableItem(s.actor)&&noclipIdentity(s.pickup,s.pickupIndex,s.pickupNumber)&&s.actor.add(344).readPointer().equals(s.pawn)){
    try{freeWorldItem(s.actor);call(s.pickup,'BP_PickupComponent_C','Server_ThrowRO',p=>{p.writePointer(s.actor);p.add(8).writeU8(1);});}catch(e){log('error',{where:'release-disguise-fish',message:String(e)});}
  }
  if(noclipIdentity(s.pawn,s.index,s.number)){
    try{call(s.pawn,'BP_WaterPlayerCharacter_C','Server_ToggleCharacterVisibility',p=>p.writeU8(s.visible?1:0));s.pawn.add(2648).writeU8(s.visible?1:0);call(s.pawn,'BP_WaterPlayerCharacter_C','OnRep_bCharacterVisible');}catch(e){log('error',{where:'restore-disguise',message:String(e)});}
  }
  noclipEnd('disguise-off');log('fish-disguise',{enabled:false});notify(tr('Обычный облик возвращён; рыба осталась рядом'));
}
function freeWorldItem(a){
  call(a,'Actor','K2_DetachFromActor',p=>{p.writeU8(1);p.add(1).writeU8(1);p.add(2).writeU8(1);});
  const sync=readp(a,'SmoothSync'),mesh=readp(a,'Mesh');
  call(sync,'SmoothSync','enableSmoothSync',p=>p.writeU8(1));call(sync,'ActorComponent','SetComponentTickEnabled',p=>p.writeU8(1));
  call(a,'BP_Holdable_C','ToggleShowMesh',p=>p.writeU8(1));
  call(mesh,'PrimitiveComponent','SetCollisionEnabled',p=>p.writeU8(3));
  call(mesh,'PrimitiveComponent','SetSimulatePhysics',p=>p.writeU8(1));
  call(a,'BP_Holdable_C','ReturnPawnCollision');
  call(mesh,'PrimitiveComponent','SetCollisionResponseToChannel',p=>{p.writeU8(3);p.add(1).writeU8(2);});
  return sync;
}
function dropMonsterFish(){
  if(funJob||spawnJob||materialJob)return notify(tr('Дождись завершения действия'));
  if(fishDisguise){setFishDisguise(false);return;}
  const a=caughtFish();if(!usableItem(a))return notify(tr('В руках нет отдельного улова'));
  const f=pawn.add(1744).readPointer();if(usableItem(readp(f,'PickupFishActorClientProxy')))return notify(tr('Этот улов положи обычной кнопкой игры'));
  if(fishDisguise)setFishDisguise(false);
  freeWorldItem(a);
  call(ownPickup(),'BP_PickupComponent_C','Server_ThrowRO',p=>{p.writePointer(a);p.add(8).writeU8(1);p.add(9).writeU8(0);});
  call(f,'BP_FishingComponent_C','Client_RemovePickupFishActor');
  notify(tr('Рыба положена рядом'));log('monster-dropped',{actor:a.toString()});
}
// Reuse the Unreal output array between scans rather than allocating one per frame.
let rainActorParams=null;
function mushroomActors(){
  if(!rainActorParams){rainActorParams=Memory.alloc(128);rainActorParams.writeByteArray(new Uint8Array(128));}
  rainActorParams.writePointer(pawn);rainActorParams.add(8).writePointer(classes.BP_Consumable_Grib_C);
  pe(defaults.GameplayStatics,fn('GameplayStatics','GetAllActorsOfClass'),rainActorParams);
  const data=rainActorParams.add(16).readPointer(),count=rainActorParams.add(24).readS32(),out=[];
  if(count<0||count>100000)throw new Error('Invalid mushroom actor array');
  for(let i=0;i<count;i++){const a=data.add(i*8).readPointer();if(valid(a))out.push(a);}
  return out;
}
function mushroomToken(a){return a.toString()+':'+a.add(12).readU32()+':'+a.add(28).readU32();}
function startMushroomRain(count){
  if(funJob||spawnJob||materialJob)return notify(tr('Сначала заверши текущее действие'));
  if(!valid(pawn)||cls(pawn)!=='BP_WaterPlayerCharacter_C'||noclipGameLocked(pawn))return notify(tr('Сначала встань и вернись к персонажу'));
  const f=pawn.add(1744).readPointer();
  if(!valid(f)||usableItem(caughtFish())||usableItem(readp(f,'PickupFishActorClientProxy'))||ownHooks().some(castActive))return notify(tr('Сначала закончи рыбалку и положи улов'));
  const total=clampRainCount(count===undefined?config.rainCount:count),now=Date.now();
  funJob={type:'rain',phase:'direct',done:0,sent:0,total,pawn,index:pawn.add(12).readU32(),number:pawn.add(28).readU32(),f,seen:new Set(mushroomActors().map(mushroomToken)),pending:{},nextSend:0,nextScan:0,started:now,deadline:now+8000};
  notify(tr('Грибной дождь: ')+localizedMushrooms(total));
}
function rainTick(j){
  const now=Date.now();
  if(usableItem(caughtFish())||usableItem(readp(j.f,'PickupFishActorClientProxy'))||ownHooks().some(castActive))return cancelFunJob(tr('Дождь остановлен: началась рыбалка'));
  if(now>=j.nextScan){
    j.nextScan=now+60;
    for(const a of mushroomActors()){
      const token=mushroomToken(a);if(j.seen.has(token)||!a.add(344).readPointer().equals(j.pawn))continue;
      const id=itemId(a);if(!(j.pending[id]>0)||!usableItem(a))continue;
      j.seen.add(token);j.pending[id]--;
      const pos=noclipVector(location(pawn)),yaw=call(pc,'Controller','GetControlRotation').add(8).readDouble()*Math.PI/180,angle=Math.random()*Math.PI*2,r=70+Math.sqrt(Math.random())*(j.total>30?340:190);
      pos[0]+=Math.cos(yaw)*240+Math.cos(angle)*r;pos[1]+=Math.sin(yaw)*240+Math.sin(angle)*r;pos[2]+=400+Math.random()*200;
      const sync=freeWorldItem(a);
      // Explicit actor branch: preserve any ordinary tool held by the player.
      call(ownPickup(),'BP_PickupComponent_C','Server_ThrowRO',p=>{p.writePointer(a);p.add(8).writeU8(1);});
      call(a,'Actor','K2_SetActorLocation',p=>{pos.forEach((v,i)=>p.add(i*8).writeDouble(v));p.add(288).writeU8(1);});
      call(sync,'SmoothSync','Teleport');call(sync,'SmoothSync','forceStateSendNextFrame');
      j.done++;j.deadline=now+8000;
      log('mushroom-rain',{done:j.done,total:j.total,id,actor:a.toString(),position:pos,route:'direct',elapsedMs:now-j.started});
    }
  }
  if(j.done>=j.total){funJob=null;const seconds=((now-j.started)/1000).toFixed(1);notify(tr('Грибной дождь: ')+j.done+tr(' шт. за ')+seconds+tr(' с'));log('rain-complete',{count:j.done,elapsedMs:now-j.started,route:'direct'});return;}
  if(now>=j.nextSend&&j.sent<j.total){
    j.nextSend=now+60;
    const list=CATALOG.entries.filter(e=>e.category==='mushrooms');
    for(let n=0;n<4&&j.sent<j.total&&j.sent-j.done<8;n++){
      const id=list[Math.floor(Math.random()*list.length)].id;
      call(j.f,'BP_FishingComponent_C','Server_PickupFish',p=>{p.writeU64(uint64(items[id].key));p.add(8).writeDouble(1);p.add(24).writeDouble(1);});
      j.sent++;j.pending[id]=(j.pending[id]||0)+1;
    }
  }
}
function cancelFunJob(message){const j=funJob;funJob=null;if(spawnJob?.fun){spawnJob.mode='hand';spawnJob.fun=false;spawnJob.quiet=false;}if(j)notify(message||(tr('Остановлено: ')+j.done+tr(' из ')+j.total));}
function funTick(){
  const s=fishDisguise;
  if(s&&(!pawn.equals(s.pawn)||!noclipIdentity(s.pawn,s.index,s.number)||!noclipIdentity(s.actor,s.actorIndex,s.actorNumber)||!usableItem(s.actor)||!s.actor.add(344).readPointer().equals(s.pawn)||noclipGameLocked(s.pawn)))setFishDisguise(false);
  const j=funJob;if(!j)return;
  if(!pawn.equals(j.pawn)||!noclipIdentity(j.pawn,j.index,j.number))return cancelFunJob(tr('Действие остановлено: персонаж сменился'));
  if(Date.now()>j.deadline)return cancelFunJob(tr('Сервер не подтвердил действие; готово ')+j.done+'/'+j.total);
  if(j.phase==='fish'){
    const a=caughtFish();if(!usableItem(a))return;
    if(itemId(a)!==j.id)return cancelFunJob(tr('В руках появился другой улов'));
    const size=noclipVector(call(a,'Actor','GetActorScale3D'));log('monster-created',{id:j.id,actor:a.toString(),scale:size,requested:j.scale});
    funJob=null;if(j.type==='disguise')applyFishDisguise(a);else notify(tr('Рыба-монстр готова. Можно стать ею или положить рядом'));return;
  }
  if(j.type==='rain')rainTick(j);
}

let repairJob=null;
function objectArray(p,n){const a=p.add(field(cls(p),n)),len=a.add(8).readS32(),d=a.readPointer(),out=[];if(len<0||len>500)return out;for(let i=0;i<len;i++){const q=d.add(i*8).readPointer();if(valid(q))out.push(q);}return out;}
function repair(){
  if(!usableItem(pawn)||cls(pawn)!=='BP_WaterPlayerCharacter_C'||noclipGameLocked(pawn))return notify(tr('Сначала вернись к управлению персонажем'));
  const boat=nearestBoat();if(!usableItem(boat))return notify(tr('Лодка не найдена'));
  const damaged=[...objectArray(boat,'HealthPanels'),...objectArray(boat,'HealthHoles')].filter(p=>usableItem(p)&&p.add(field(cls(p),'bDestroyed')).readU8()!==0);
  const targets=damaged.filter(p=>call(p,'BP_HealthPlateParent_C','CanAffordRepair').readU8()!==0);
  repairJob={character:pawn,characterIndex:pawn.add(12).readU32(),characterNumber:pawn.add(28).readU32(),
    controller:pc,controllerIndex:pc.add(12).readU32(),controllerNumber:pc.add(28).readU32(),
    boat,boatIndex:boat.add(12).readU32(),boatNumber:boat.add(28).readU32(),
    targets:targets.map(p=>({p,index:p.add(12).readU32(),number:p.add(28).readU32(),attempts:0,last:-1,stalled:0})),
    total:damaged.length,done:0,failed:damaged.length-targets.length,next:0};
  notify(targets.length?tr('Ремонт: обрабатываю повреждённые детали'):damaged.length?tr('Не хватает материалов в ящиках лодки'):tr('Корпус и пробоины уже целы'));
  if(!targets.length)repairJob=null;
}
function repairTick(){
  const job=repairJob;if(!job)return;
  if(!noclipIdentity(job.character,job.characterIndex,job.characterNumber)||!usableItem(job.character)||
     !pawn.equals(job.character)||cls(job.character)!=='BP_WaterPlayerCharacter_C'||noclipGameLocked(job.character)||
     !noclipIdentity(job.controller,job.controllerIndex,job.controllerNumber)||!pc.equals(job.controller)||!readp(job.character,'Controller').equals(job.controller)||
     !noclipIdentity(job.boat,job.boatIndex,job.boatNumber)||!usableItem(job.boat)){
    repairJob=null;notify(tr('Ремонт остановлен: управление персонажем или лодка изменились'));return;
  }
  if(Date.now()<job.next)return;job.next=Date.now()+350;
  const t=job.targets[0];
  if(!t){notify(tr('Ремонт: ')+job.done+tr(' готово')+(job.failed?tr(' | Не удалось починить: ')+job.failed:''));repairJob=null;return;}
  if(!noclipIdentity(t.p,t.index,t.number)||!usableItem(t.p)){job.targets.shift();job.failed++;return;}
  const c=cls(t.p);if(!t.p.add(field(c,'bDestroyed')).readU8()){job.done++;job.targets.shift();return;}
  const progress=t.p.add(field(c,'CurrentRepairProgress')).readS32();
  if(progress===t.last)t.stalled++;else t.stalled=0;
  if(t.stalled>=4||t.attempts>=30){job.failed++;job.targets.shift();return;}
  t.last=progress;t.attempts++;
  const tool=t.p.add(field(c,'RequiredRepairTool')).readU8();
  try{call(job.character,'BP_WaterPlayerCharacter_C','Server_RepairBoat',p=>{p.writeU8(tool);p.add(8).writePointer(t.p);});}
  catch(e){repairJob=null;notify(tr('Ремонт прерван из-за ошибки'));throw e;}
  log('repair-step',{target:name(t.p),tool,progress});
}

function isHost(){return valid(pawn)&&pawn.add(360).readU8()===3;}
function fuelTick(){if(!isHost()){config.fuel=false;return;}const b=nearestBoat();if(!valid(b))return;const engine=readp(b,'BoatEngine');if(valid(engine)&&engine.add(360).readU8()===3)engine.add(field(cls(engine),'CurrentFuel')).writeDouble(1);}
const quickTimers=new Map(),timerName=Memory.allocUtf16String('SpawnFishOnHook');
function quickTick(){if(quickTimers.size>512)quickTimers.clear();for(const h of ownHooks()){if(h.add(776).readU8()||h.add(913).readU8()||h.add(912).readU8()||valid(h.add(904).readPointer()))continue;const handle=h.add(1120).readU64();if(handle.equals(uint64(0)))continue;const token=h+':'+h.add(12).readU32()+':'+handle;if(quickTimers.has(token))continue;const remains=call(defaults.KismetSystemLibrary,'KismetSystemLibrary','K2_GetTimerRemainingTimeHandle',p=>{p.writePointer(h);p.add(8).writeU64(handle);}).add(16).readFloat();if(remains<=0.5)continue;const p=call(defaults.KismetSystemLibrary,'KismetSystemLibrary','K2_SetTimer',p=>{p.writePointer(h);p.add(8).writePointer(timerName);p.add(16).writeS32(16);p.add(20).writeS32(16);p.add(24).writeFloat(0.4);});const newHandle=p.add(40).readU64();h.add(1120).writeU64(newHandle);quickTimers.set(token,true);quickTimers.set(h+':'+h.add(12).readU32()+':'+newHandle,true);log('quick-bite',{hook:h.toString(),oldRemaining:remains,newTime:0.4});}}
function inputLock(on){const ok=uiSetOpen(on);heldLock=!!on&&ok;if(on&&!ok)config.open=false;return ok;}
function setOpen(on){if(on&&!config.open&&valid(pc)&&pc.add(2193).readU8()){notify(tr('Закрой меню паузы, затем нажми F8'));return;}if(on&&!fishDisguise)noclipEnd('menu');config.open=!!on;inputLock(config.open);}
function setFeature(key,value){if(!(key in config))throw new Error('Unknown option');if(key==='open')setOpen(value);else config[key]=key==='lang'?(value==='en'?'en':'ru'):key==='noclipSpeed'?clampNoclipSpeed(value):key==='monsterScale'?clampMonsterScale(value):key==='rainCount'?clampRainCount(value):value;if(key==='lang'){uiState.filterSignature='';notify(config.lang==='en'?'Language: English':'Язык: Русский');}if(key==='noclip'&&!value){setFishDisguise(false);noclipEnd('disabled');}if(key==='quick'&&!value)restoreDoubles();if(key==='keepFish'&&!value&&[...protectedHooks.values()].some(r=>sameHook(r)&&castActive(r.p)))notify(tr('Защита отключится после текущего заброса'));log('config',{config});}
const aimAttempts=new Map();
function restoreMissingAim(){if(!valid(pawn)||!ownRods().length)return;const fc=pawn.add(1744).readPointer();if(!valid(fc)||!fc.add(336).readPointer().equals(pawn)||valid(fc.add(344).readPointer()))return;const token=fc+':'+fc.add(12).readU32();if(aimAttempts.has(token))return;aimAttempts.set(token,true);call(fc,'BP_FishingComponent_C','ExecuteUbergraph_BP_FishingComponent',p=>p.writeS32(7799));const aim=fc.add(344).readPointer();log('restore-aim',{component:fc.toString(),target:aim.toString(),valid:valid(aim)});}
function tick(){const now=Date.now();restoreMissingAim();keepFishTick();spawnTick();materialTick();funTick();if(config.quick)quickTick();if(config.fuel)fuelTick();repairTick();if(now-lastStatus>2000){lastStatus=now;log('status',snapshot());}}
function snapshot(){const held=heldItem();return {config,pc:pc.toString(),pawn:pawn.toString(),role:valid(pawn)?pawn.add(360).readU8():null,held:valid(held)?{p:held.toString(),name:name(held),cls:cls(held)}:null,fun:funJob?{type:funJob.type,phase:funJob.phase,done:funJob.done,total:funJob.total}:null,fishDisguise:fishDisguise?{actor:fishDisguise.actor.toString()}:null,noclip:noclipState?{kind:noclipState.kind||"character",position:noclipState.position,speed:noclipState.baseSpeed*noclipMultiplier(),multiplier:noclipMultiplier()}:null,hooks:ownHooks().map(h=>({p:h.toString(),time:h.add(768).readDouble(),cast:h.add(976).readU8(),hooked:h.add(912).readU8(),fish:h.add(904).readPointer().toString()})),lastError};}
// ProcessInternal receives a reflected FFrame. The native filter invokes JS only
// for this fishing RPC, without adding JS overhead to other Blueprint calls.
const hookTickCallback=(obj=>{try{if(!stopped&&ownHook(obj))protectHook(obj);}catch(e){log('error',{where:'keep-fish',message:String(e)});}});
const fishCallback=((obj,frame)=>{try{if(stopped||!ownHook(obj))return;const p=frame.add(0x28).readPointer();let id=fname(p.readU32());if(config.fish>0){id=CATALOG.fish[config.fish-1].id;p.writeU64(uint64(fish[id].key));p.add(8).writeDouble(fish[id].row.add(48).readDouble());}if(config.big&&fish[id])p.add(8).writeDouble(fish[id].row.add(48).readDouble()*2);log('fish-rpc',{id,scale:p.add(8).readDouble(),hook:obj.toString()});}catch(e){log('error',{where:'fish-rpc',message:String(e)});}});
__registerProcess(fn('BP_FishingHook_C','Server_SpawnFishOnHook').value,fn('BP_FishingHook_C','HookTick').value,(obj,frame)=>fishCallback(ptr(obj),ptr(frame)),obj=>hookTickCallback(ptr(obj)));
const keyState=new NativeFunction(Module.getExportByName('user32.dll','GetAsyncKeyState'),'int16',['int']);
const foreground=new NativeFunction(Module.getExportByName('user32.dll','GetForegroundWindow'),'pointer',[]);
const windowPid=new NativeFunction(Module.getExportByName('user32.dll','GetWindowThreadProcessId'),'uint32',['pointer','pointer']);
const pidbuf=Memory.alloc(4),pressed={};
function key(k){const down=(keyState(k)&0x8000)!==0,edge=down&&!pressed[k];pressed[k]=down;return edge;}
function focused(){windowPid(foreground(),pidbuf);return pidbuf.readU32()===Process.id;}
const rect=Memory.alloc(64),textParams=Memory.alloc(64),textureParams=Memory.alloc(96),strings=new Map();
const white=[0.90,0.96,1,1],muted=[0.42,0.63,0.70,1],green=[0.23,0.92,0.64,1],amber=[1,0.73,0.28,1];
function color(p,c){for(let i=0;i<4;i++)p.add(i*4).writeFloat(c[i]);}
function box(x,y,w,h,c){color(rect,c);[x,y,w,h].forEach((v,i)=>rect.add(16+i*4).writeFloat(v));pe(hudNow,fn('HUD','DrawRect'),rect);}
function text(s,x,y,size=1.7,c=white){let mem=strings.get(s);if(!mem){if(strings.size>400)strings.clear();mem=Memory.allocUtf16String(s);strings.set(s,mem);}textParams.writePointer(mem);textParams.add(8).writeS32(s.length+1);textParams.add(12).writeS32(s.length+1);color(textParams.add(16),c);textParams.add(32).writeFloat(x);textParams.add(36).writeFloat(y);textParams.add(40).writePointer(font);textParams.add(48).writeFloat(size);textParams.add(52).writeU8(0);pe(hudNow,fn('HUD','DrawText'),textParams);}
function icon(id,x,y,size){const t=items[id]?.row.add(32).readPointer();if(!t||!valid(t))return;textureParams.writeByteArray(new Uint8Array(96));textureParams.writePointer(t);[x,y,size,size,0,0,1,1].forEach((v,i)=>textureParams.add(8+i*4).writeFloat(v));color(textureParams.add(40),[1,1,1,1]);textureParams.add(56).writeU8(2);textureParams.add(60).writeFloat(1);pe(hudNow,fn('HUD','DrawTexture'),textureParams);}
function cleanup(){if(stopped)return;setFishDisguise(false);cancelFunJob();noclipEnd('unload');setOpen(false);restoreDoubles();restoreHooks();spawnJob=null;materialJob=null;config.fuel=false;stopped=true;for(const h of listeners)h.detach();log('stopped',{});}
function processCommand(c){try{let result;if(c.op==='eval')result=eval(c.code);else if(c.op==='config'){for(const [k,v]of Object.entries(c.values))setFeature(k,v);result=snapshot();}else if(c.op==='issue'){issue(c.id);result=snapshot();}else if(c.op==='repair'){repair();result=snapshot();}else if(c.op==='stop'){cleanup();result=true;}else result=snapshot();log('result',{request:c.request,result});}catch(e){log('result',{request:c.request,error:String(e),stack:e.stack});}}
globalThis.__wydCommand=processCommand;globalThis.__wydCleanup=cleanup;
uiInit();
let drawing=false;
__registerHud(hudAddress=>{if(stopped||drawing)return;drawing=true;try{hudNow=ptr(hudAddress);const current=hudNow.add(688).readPointer();if(!valid(current)){setFishDisguise(false);noclipEnd('controller-lost');return;}const oldPC=pc;pc=current;pawn=pc.add(752).readPointer();if(!oldPC.equals(pc)){setFishDisguise(false);noclipEnd('controller-changed');heldLock=false;if(config.open)inputLock(true);}while(queue.length)processCommand(queue.shift());if(stopped)return;const now=Date.now();if(focused()){if(key(0x79)){cleanup();return;}if(key(0x77))setOpen(!config.open);}noclipFrame(now);uiBeforeDraw();if(config.open)uiKeyboard();if(now-lastTick>((materialJob||funJob||fishDisguise)?16:150)){lastTick=now;tick();}uiDraw();}catch(e){if(fishDisguise)setFishDisguise(false);if(noclipState)noclipEnd('error');if(funJob)cancelFunJob(tr('Действие остановлено из-за ошибки'));const msg=String(e);if(msg!==lastError){lastError=msg;log('error',{where:'hud',message:msg,stack:e.stack});}}finally{drawing=false;}});
log('ready',{pid:Process.id,font:name(font),items:Object.keys(items).length,fish:Object.keys(fish).length});
