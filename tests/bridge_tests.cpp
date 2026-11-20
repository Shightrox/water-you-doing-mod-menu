#include <windows.h>
#include <fstream>
#include <iostream>
#include <string>
#include "native_bridge.h"
static uint64_t Test3(uintptr_t out,uintptr_t a,uintptr_t b){*reinterpret_cast<uint64_t*>(out)=a+b;return 0;}
static bool Eval(JSContext* c,const std::string& s,const char* n,int flags=JS_EVAL_TYPE_GLOBAL){auto r=JS_Eval(c,s.c_str(),s.size(),n,flags);if(JS_IsException(r)){auto e=JS_GetException(c);const char* t=JS_ToCString(c,e);std::cerr<<(t?t:"error")<<"\n";if(t)JS_FreeCString(c,t);auto stack=JS_GetPropertyStr(c,e,"stack");t=JS_ToCString(c,stack);if(t){std::cerr<<t<<"\n";JS_FreeCString(c,t);}JS_FreeValue(c,stack);JS_FreeValue(c,e);return false;}JS_FreeValue(c,r);return true;}
static std::string Read(const char* p){std::ifstream f(p,std::ios::binary);return std::string(std::istreambuf_iterator<char>(f),{});}
int main(int argc,char**argv){if(argc<3)return 2;auto rt=JS_NewRuntime();JS_SetMaxStackSize(rt,4*1024*1024);auto c=JS_NewContext(rt);auto g=JS_GetGlobalObject(c);JS_SetPropertyStr(c,g,"__base",JS_NewBigUint64(c,reinterpret_cast<uintptr_t>(GetModuleHandleW(nullptr))));JS_SetPropertyStr(c,g,"__size",JS_NewInt32(c,152158208));JS_SetPropertyStr(c,g,"__pid",JS_NewInt32(c,GetCurrentProcessId()));JS_SetPropertyStr(c,g,"__test3",JS_NewBigUint64(c,reinterpret_cast<uintptr_t>(&Test3)));JS_FreeValue(c,g);
 bool ok=InitializeMemoryBridge(c)&&Eval(c,Read(argv[1]),"shim.js");
 if(ok)ok=Eval(c,R"JS(
function assert(ok,label){if(!ok)throw new Error(label);}
let b=Memory.alloc(128);assert(!b.isNull(),'alloc');
b.writeU64(uint64('18364758544493064720'));assert(b.readU64().toString()==='18364758544493064720','64-bit precision');assert(b.readU64().equals(uint64('18364758544493064720')),'UInt64.equals');
b.add(8).writeS32(-1234567);assert(b.add(8).readS32()===-1234567,'signed');
b.add(16).writeDouble(Math.PI);assert(b.add(16).readDouble()===Math.PI,'double');b.add(24).writeFloat(1.25);assert(b.add(24).readFloat()===1.25,'float');
b.add(32).writePointer(b);assert(b.add(32).readPointer().equals(b),'pointer');
b.add(48).writeByteArray(new Uint8Array([1,2,3,255]));assert(b.add(51).readU8()===255,'bytes');
const text=Memory.allocUtf16String('Привет 🐟');assert(text.readUtf16String(9)==='Привет 🐟','UTF16');
let failed=false;try{ptr(1).readU32();}catch(e){failed=true;}assert(failed,'bad pointer');
const f=new NativeFunction(ptr(__test3),'void',['pointer','pointer','pointer']);f(b,ptr(20),ptr(22));assert(b.readU64().toString()==='42','native dispatch');
const pidFn=new NativeFunction(Module.getExportByName('kernel32.dll','GetCurrentProcessId'),'uint32',[]);assert(pidFn()===Process.id,'native export');
assert(ptr('0xffffffffffffffff').add(1).isNull(),'pointer wrap');assert(ptr(16).toString()==='0x10','pointer format');assert(JSON.stringify({p:b,u:uint64(8)}).includes('0x'),'json');
globalThis.retained=Memory.alloc(8).add(0);retained.writeU64(uint64(77));
)JS","bridge-tests.js");
 if(ok&&argc>3)ok=Eval(c,Read(argv[3]),"bridge-edge-tests.js");
 JS_RunGC(rt);if(ok)ok=Eval(c,"assert(retained.readU64().toString()==='77','owner survives GC');","gc-test.js");
 if(ok)ok=Eval(c,Read(argv[2]),"mod-transformed.js",JS_EVAL_TYPE_GLOBAL|JS_EVAL_FLAG_COMPILE_ONLY);
 JS_FreeContext(c);JS_FreeRuntime(rt);std::cout<<(ok?"BRIDGE TESTS PASSED\n":"BRIDGE TESTS FAILED\n");return ok?0:1;}
