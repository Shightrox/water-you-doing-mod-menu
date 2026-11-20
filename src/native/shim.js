// Frida-compatible subset used by wyd-menu.js and wyd-ui.js. No hooks, threads
// or timers live here: the native host owns dispatch and the QuickJS runtime.
(function (g) {
  'use strict';
  const read = g.__read, write = g.__write, alloc = g.__alloc;
  const nativeCall = g.__nativeCall, getExport = g.__getExport;
  const U8=0, U16=1, U32=2, S32=3, U64=4, FLOAT=5, DOUBLE=6, POINTER=7, CSTRING=8, UTF16=9, BYTES=10;
  // QuickJS-ng 0.11.0's asUintN incorrectly sign-extends some limb-boundary
  // values (including UINT64_MAX). Do not use it for addresses or FNames.
  const MOD64=18446744073709551616n, MAX64=MOD64-1n, MOD32=4294967296n;
  const mask64 = n => n>=0n&&n<=MAX64?n:(n%MOD64+MOD64)%MOD64;
  function integer(value) {
    if (value instanceof NativePointer || value instanceof UInt64) return value.value;
    if (typeof value === 'number' && !Number.isSafeInteger(value))
      throw new TypeError('Use a string or BigInt for integers outside the safe Number range');
    return BigInt(value);
  }
  function bytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (Array.isArray(value)) return Uint8Array.from(value);
    throw new TypeError('Expected an ArrayBuffer, typed array or byte array');
  }
  class UInt64 {
    constructor(value) { this.value = mask64(integer(value)); }
    equals(other) { return this.value === mask64(integer(other)); }
    compare(other) { const n=mask64(integer(other)); return this.value<n?-1:this.value>n?1:0; }
    toString(radix=10) { return this.value.toString(radix); }
    toNumber() { return Number(this.value); }
    toJSON() { return this.toString(); }
    [Symbol.toPrimitive](hint) { return hint === 'number' ? this.toNumber() : this.toString(); }
  }
  class NativePointer {
    constructor(value, owner) {
      this.value = mask64(integer(value));
      // Every derived pointer retains the allocation, including ptr(existing).
      this._owner = owner || (value instanceof NativePointer ? value._owner : null);
    }
    add(offset) { return new NativePointer(mask64(this.value + integer(offset)), this._owner); }
    sub(offset) { return new NativePointer(mask64(this.value - integer(offset)), this._owner); }
    equals(other) { return this.value === mask64(integer(other)); }
    compare(other) { const n=mask64(integer(other)); return this.value<n?-1:this.value>n?1:0; }
    isNull() { return this.value === 0n; }
    toInt32() { return Number(this.value%MOD32)|0; }
    toUInt32() { return Number(this.value%MOD32); }
    toString(radix) { return radix === undefined ? '0x'+this.value.toString(16) : this.value.toString(radix); }
    toJSON() { return this.toString(); }
    [Symbol.toPrimitive]() { return this.toString(); }
    readU8() { return read(this.value,U8); }
    readU16() { return read(this.value,U16); }
    readU32() { return read(this.value,U32); }
    readS32() { return read(this.value,S32); }
    readU64() { return new UInt64(read(this.value,U64)); }
    readFloat() { return read(this.value,FLOAT); }
    readDouble() { return read(this.value,DOUBLE); }
    readPointer() { return new NativePointer(read(this.value,POINTER)); }
    readCString(length) { return read(this.value,CSTRING,length); }
    readUtf8String(length) { return read(this.value,CSTRING,length); }
    readUtf16String(length) { return read(this.value,UTF16,length); }
    readByteArray(length) { return read(this.value,BYTES,length); }
    writeU8(value) { write(this.value,U8,value); return this; }
    writeU16(value) { write(this.value,U16,value); return this; }
    writeU32(value) { write(this.value,U32,value); return this; }
    writeS32(value) { write(this.value,S32,value); return this; }
    writeU64(value) { write(this.value,U64,mask64(integer(value))); return this; }
    writeFloat(value) { write(this.value,FLOAT,value); return this; }
    writeDouble(value) { write(this.value,DOUBLE,value); return this; }
    writePointer(value) { write(this.value,POINTER,mask64(integer(value))); return this; }
    writeCString(value) { write(this.value,CSTRING,String(value)); return this; }
    writeUtf8String(value) { return this.writeCString(value); }
    writeUtf16String(value) {
      const s=String(value), data=new Uint16Array(s.length+1);
      for(let i=0;i<s.length;i++) data[i]=s.charCodeAt(i);
      return this.writeByteArray(data);
    }
    writeByteArray(value) { write(this.value,BYTES,bytes(value)); return this; }
  }
  function ptr(value) { return value instanceof NativePointer ? value : new NativePointer(value); }
  function uint64(value) { return new UInt64(value); }
  const Memory = {
    alloc(size) { const owner=alloc(size); return new NativePointer(owner.address,owner); },
    allocUtf16String(value) { const s=String(value); return this.alloc((s.length+1)*2).writeUtf16String(s); },
    allocUtf8String(value) {
      const s=String(value); // Three bytes per UTF-16 unit bounds UTF-8 output.
      return this.alloc(s.length*3+1).writeCString(s);
    }
  };
  const returnCodes = {void:0,pointer:1,int16:2,uint32:3};
  const argumentTypes = new Set(['pointer','int','int32','uint','uint32','int16','uint16','int8','uint8','int64','uint64']);
  function nativeArgument(value,type) {
    if(type==='pointer'||type==='uint64'||type==='int64') return mask64(integer(value));
    const n=integer(value), bits=type.endsWith('16')?16:type.endsWith('8')?8:32;
    const modulus=1n<<BigInt(bits), unsigned=(n%modulus+modulus)%modulus;
    return mask64(!type.startsWith('u')&&unsigned>=modulus/2n?unsigned-modulus:unsigned);
  }
  function NativeFunction(address,returnType,argumentList) {
    const target=ptr(address), code=returnCodes[returnType];
    if(code===undefined) throw new TypeError('Unsupported NativeFunction return type: '+returnType);
    if(!Array.isArray(argumentList)||argumentList.length>3||argumentList.some(t=>!argumentTypes.has(t)))
      throw new TypeError('NativeFunction supports at most three integer/pointer arguments');
    if(target.isNull()) throw new TypeError('Cannot call a null function');
    const types=argumentList.slice();
    return function (...args) {
      if(args.length!==types.length) throw new TypeError('NativeFunction argument count mismatch');
      const result=nativeCall(target.value,code,args.map((v,i)=>nativeArgument(v,types[i])));
      return code===1?new NativePointer(result):result;
    };
  }
  const Module = { getExportByName(module,name) { return ptr(getExport(module,name)); } };
  const Process = {
    mainModule:{base:ptr(g.__base),size:g.__size},
    pointerSize:8,
    id:g.__pid
  };
  Object.assign(g,{NativePointer,UInt64,ptr,uint64,Memory,NativeFunction,Module,Process});
})(globalThis);
