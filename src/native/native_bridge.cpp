#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "native_bridge.h"

static_assert(sizeof(void*) == 8, "The bridge requires Win64");

namespace {
enum MemoryType { U8, U16, U32, S32, U64, Float, Double, Pointer, CString, Utf16, Bytes };
enum ReturnType { ReturnVoid, ReturnPointer, ReturnInt16, ReturnUInt32 };
constexpr uint64_t kMaxBytes = 64ull * 1024 * 1024;
constexpr size_t kMaxStringUnits = 16u * 1024 * 1024;

// Keep __try confined to POD-only helpers. In particular, no QuickJS API,
// C++ object requiring unwinding, or allocation belongs inside these blocks.
static int MemoryExceptionFilter(DWORD code) {
    switch (code) {
    case EXCEPTION_ACCESS_VIOLATION:
    case EXCEPTION_IN_PAGE_ERROR:
    case EXCEPTION_DATATYPE_MISALIGNMENT:
    case EXCEPTION_ILLEGAL_INSTRUCTION:
    case EXCEPTION_PRIV_INSTRUCTION:
        return EXCEPTION_EXECUTE_HANDLER;
    default:
        return EXCEPTION_CONTINUE_SEARCH;
    }
}

static bool SafeCopy(void* dst, const void* src, size_t size, DWORD* fault) {
    __try {
        if (size) memcpy(dst, src, size);
        return true;
    } __except (MemoryExceptionFilter(GetExceptionCode())) {
        *fault = GetExceptionCode();
        return false;
    }
}

static bool SafeStringLength(uint64_t address, size_t limit, bool wide,
                             size_t* length, DWORD* fault) {
    size_t n = 0;
    __try {
        if (wide) {
            const volatile uint16_t* p = reinterpret_cast<const volatile uint16_t*>(address);
            while (n < limit && p[n]) ++n;
        } else {
            const volatile uint8_t* p = reinterpret_cast<const volatile uint8_t*>(address);
            while (n < limit && p[n]) ++n;
        }
        *length = n;
        return true;
    } __except (MemoryExceptionFilter(GetExceptionCode())) {
        *fault = GetExceptionCode();
        return false;
    }
}

// The Windows x64 integer/pointer ABI uses RCX/RDX/R8 and RAX. A real void
// prototype is used for void calls, so no indeterminate return value is read.
static bool SafeNativeCall(uint64_t address, int returnType, unsigned count,
                           const uint64_t* a, uint64_t* result, DWORD* fault) {
    __try {
        if (returnType == ReturnVoid) {
            switch (count) {
            case 0: reinterpret_cast<void(*)()>(address)(); break;
            case 1: reinterpret_cast<void(*)(uint64_t)>(address)(a[0]); break;
            case 2: reinterpret_cast<void(*)(uint64_t,uint64_t)>(address)(a[0],a[1]); break;
            case 3: reinterpret_cast<void(*)(uint64_t,uint64_t,uint64_t)>(address)(a[0],a[1],a[2]); break;
            }
            *result = 0;
        } else {
            switch (count) {
            case 0: *result = reinterpret_cast<uint64_t(*)()>(address)(); break;
            case 1: *result = reinterpret_cast<uint64_t(*)(uint64_t)>(address)(a[0]); break;
            case 2: *result = reinterpret_cast<uint64_t(*)(uint64_t,uint64_t)>(address)(a[0],a[1]); break;
            case 3: *result = reinterpret_cast<uint64_t(*)(uint64_t,uint64_t,uint64_t)>(address)(a[0],a[1],a[2]); break;
            }
        }
        return true;
    } __except (MemoryExceptionFilter(GetExceptionCode())) {
        *fault = GetExceptionCode();
        return false;
    }
}

static JSValue Fault(JSContext* ctx, const char* operation, uint64_t address, DWORD code) {
    return JS_ThrowInternalError(ctx, "%s at 0x%llx failed (SEH 0x%08lx)",
                                operation, static_cast<unsigned long long>(address),
                                static_cast<unsigned long>(code));
}

static bool ToAddress(JSContext* ctx, JSValueConst value, uint64_t* address) {
    return JS_ToBigUint64(ctx, address, value) >= 0;
}

static void AllocationFinalizer(JSRuntime*, JSValueConst value) {
    JSClassID id = 0;
    free(JS_GetAnyOpaque(value, &id));
}

static JSValue BridgeAlloc(JSContext* ctx, JSValueConst, int argc,
                           JSValueConst* argv, int classId) {
    uint64_t size = 0;
    if (argc < 1) return JS_ThrowTypeError(ctx, "__alloc requires a byte count");
    if (JS_ToIndex(ctx, &size, argv[0]) < 0) return JS_EXCEPTION;
    if (size > kMaxBytes) return JS_ThrowRangeError(ctx, "Allocation exceeds 64 MiB");
    void* memory = calloc(1, static_cast<size_t>(size ? size : 1));
    if (!memory) return JS_ThrowOutOfMemory(ctx);
    JSValue object = JS_NewObjectClass(ctx, static_cast<JSClassID>(classId));
    if (JS_IsException(object)) { free(memory); return object; }
    if (JS_SetOpaque(object, memory) < 0) {
        free(memory); JS_FreeValue(ctx, object);
        return JS_ThrowInternalError(ctx, "Cannot bind allocation owner");
    }
    if (JS_DefinePropertyValueStr(ctx, object, "address",
            JS_NewBigUint64(ctx, reinterpret_cast<uint64_t>(memory)), JS_PROP_ENUMERABLE) < 0 ||
        JS_DefinePropertyValueStr(ctx, object, "size", JS_NewFloat64(ctx, static_cast<double>(size)),
                                  JS_PROP_ENUMERABLE) < 0) {
        JS_FreeValue(ctx, object);
        return JS_EXCEPTION;
    }
    return object;
}

static JSValue ReadString(JSContext* ctx, uint64_t address, bool wide,
                           int argc, JSValueConst* argv) {
    if (!address) return JS_NULL;
    uint64_t limit = kMaxStringUnits;
    bool bounded = argc >= 3 && !JS_IsUndefined(argv[2]);
    if (bounded && JS_ToIndex(ctx, &limit, argv[2]) < 0) return JS_EXCEPTION;
    if (limit > kMaxStringUnits) return JS_ThrowRangeError(ctx, "String exceeds 16 Mi units");
    size_t length = 0;
    DWORD fault = 0;
    if (!SafeStringLength(address, static_cast<size_t>(limit), wide, &length, &fault))
        return Fault(ctx, "String read", address, fault);
    if (!bounded && length == limit)
        return JS_ThrowRangeError(ctx, "Unterminated string exceeds read limit");
    size_t bytes = length * (wide ? 2u : 1u);
    void* copy = malloc(bytes ? bytes : 1);
    if (!copy) return JS_ThrowOutOfMemory(ctx);
    if (!SafeCopy(copy, reinterpret_cast<const void*>(address), bytes, &fault)) {
        free(copy); return Fault(ctx, "String read", address, fault);
    }
    JSValue result = wide ? JS_NewTwoByteString(ctx, static_cast<const uint16_t*>(copy), length)
                          : JS_NewStringLen(ctx, static_cast<const char*>(copy), length);
    free(copy);
    return result;
}

static JSValue BridgeRead(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    uint64_t address = 0;
    int32_t type = 0;
    if (argc < 2) return JS_ThrowTypeError(ctx, "__read requires address and type");
    if (!ToAddress(ctx, argv[0], &address) || JS_ToInt32(ctx, &type, argv[1]) < 0) return JS_EXCEPTION;
    if (type == CString || type == Utf16) return ReadString(ctx, address, type == Utf16, argc, argv);
    DWORD fault = 0;
    if (type == Bytes) {
        uint64_t length = 0;
        if (argc < 3) return JS_ThrowTypeError(ctx, "Byte read requires length");
        if (JS_ToIndex(ctx, &length, argv[2]) < 0) return JS_EXCEPTION;
        if (length > kMaxBytes) return JS_ThrowRangeError(ctx, "Byte read exceeds 64 MiB");
        if (!address) return JS_NULL;
        size_t n = static_cast<size_t>(length);
        void* copy = malloc(n ? n : 1);
        if (!copy) return JS_ThrowOutOfMemory(ctx);
        if (!SafeCopy(copy, reinterpret_cast<const void*>(address), n, &fault)) {
            free(copy); return Fault(ctx, "Byte read", address, fault);
        }
        JSValue result = JS_NewArrayBufferCopy(ctx, static_cast<const uint8_t*>(copy), n);
        free(copy);
        return result;
    }
    union { uint64_t u64; uint32_t u32; int32_t s32; uint16_t u16; uint8_t u8; float f; double d; } v = {};
    size_t size = 0;
    switch (type) {
    case U8: size = 1; break;
    case U16: size = 2; break;
    case U32: case S32: case Float: size = 4; break;
    case U64: case Double: case Pointer: size = 8; break;
    default: return JS_ThrowTypeError(ctx, "Unknown memory read type");
    }
    if (!SafeCopy(&v, reinterpret_cast<const void*>(address), size, &fault))
        return Fault(ctx, "Memory read", address, fault);
    switch (type) {
    case U8: return JS_NewUint32(ctx, v.u8);
    case U16: return JS_NewUint32(ctx, v.u16);
    case U32: return JS_NewUint32(ctx, v.u32);
    case S32: return JS_NewInt32(ctx, v.s32);
    case Float: return JS_NewFloat64(ctx, v.f);
    case Double: return JS_NewFloat64(ctx, v.d);
    default: return JS_NewBigUint64(ctx, v.u64);
    }
}

static JSValue BridgeWrite(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    uint64_t address = 0;
    int32_t type = 0;
    if (argc < 3) return JS_ThrowTypeError(ctx, "__write requires address, type and value");
    if (!ToAddress(ctx, argv[0], &address) || JS_ToInt32(ctx, &type, argv[1]) < 0) return JS_EXCEPTION;
    DWORD fault = 0;
    if (type == CString) {
        size_t length = 0;
        const char* text = JS_ToCStringLen(ctx, &length, argv[2]);
        if (!text) return JS_EXCEPTION;
        if (length >= kMaxBytes) {
            JS_FreeCString(ctx, text);
            return JS_ThrowRangeError(ctx, "String write exceeds 64 MiB");
        }
        bool ok = SafeCopy(reinterpret_cast<void*>(address), text, length + 1, &fault);
        JS_FreeCString(ctx, text);
        return ok ? JS_UNDEFINED : Fault(ctx, "String write", address, fault);
    }
    if (type == Bytes) {
        size_t length = 0;
        uint8_t* data = JS_GetUint8Array(ctx, &length, argv[2]);
        if (!data) return JS_EXCEPTION;
        if (length > kMaxBytes) return JS_ThrowRangeError(ctx, "Byte write exceeds 64 MiB");
        return SafeCopy(reinterpret_cast<void*>(address), data, length, &fault)
            ? JS_UNDEFINED : Fault(ctx, "Byte write", address, fault);
    }
    union { uint64_t u64; uint32_t u32; int32_t s32; uint16_t u16; uint8_t u8; float f; double d; } v = {};
    size_t size = 0;
    switch (type) {
    case U8: case U16: case U32: case S32:
        if (JS_ToUint32(ctx, &v.u32, argv[2]) < 0) return JS_EXCEPTION;
        size = type == U8 ? 1 : type == U16 ? 2 : 4;
        break;
    case U64: case Pointer:
        if (JS_ToBigUint64(ctx, &v.u64, argv[2]) < 0) return JS_EXCEPTION;
        size = 8;
        break;
    case Float: case Double: {
        double d = 0;
        if (JS_ToFloat64(ctx, &d, argv[2]) < 0) return JS_EXCEPTION;
        if (type == Float) { v.f = static_cast<float>(d); size = 4; }
        else { v.d = d; size = 8; }
        break;
    }
    default: return JS_ThrowTypeError(ctx, "Unknown memory write type");
    }
    return SafeCopy(reinterpret_cast<void*>(address), &v, size, &fault)
        ? JS_UNDEFINED : Fault(ctx, "Memory write", address, fault);
}

static JSValue BridgeNativeCall(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    uint64_t address = 0, values[3] = {}, result = 0;
    int32_t returnType = 0;
    if (argc < 3) return JS_ThrowTypeError(ctx, "__nativeCall requires address, return type and arguments");
    if (!ToAddress(ctx, argv[0], &address) || JS_ToInt32(ctx, &returnType, argv[1]) < 0) return JS_EXCEPTION;
    if (!address) return JS_ThrowTypeError(ctx, "Cannot call a null function");
    if (returnType < ReturnVoid || returnType > ReturnUInt32)
        return JS_ThrowTypeError(ctx, "Unsupported native return type");
    JSValue lengthValue = JS_GetPropertyStr(ctx, argv[2], "length");
    if (JS_IsException(lengthValue)) return JS_EXCEPTION;
    uint32_t count = 0;
    int converted = JS_ToUint32(ctx, &count, lengthValue);
    JS_FreeValue(ctx, lengthValue);
    if (converted < 0) return JS_EXCEPTION;
    if (count > 3) return JS_ThrowRangeError(ctx, "Only zero to three integer/pointer arguments are supported");
    for (uint32_t i = 0; i < count; ++i) {
        JSValue item = JS_GetPropertyUint32(ctx, argv[2], i);
        if (JS_IsException(item)) return JS_EXCEPTION;
        bool ok = ToAddress(ctx, item, &values[i]);
        JS_FreeValue(ctx, item);
        if (!ok) return JS_EXCEPTION;
    }
    DWORD fault = 0;
    if (!SafeNativeCall(address, returnType, count, values, &result, &fault))
        return Fault(ctx, "Native call", address, fault);
    switch (returnType) {
    case ReturnVoid: return JS_UNDEFINED;
    case ReturnPointer: return JS_NewBigUint64(ctx, result);
    case ReturnInt16: return JS_NewInt32(ctx, static_cast<int16_t>(result));
    default: return JS_NewUint32(ctx, static_cast<uint32_t>(result));
    }
}

static JSValue BridgeGetExport(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 2) return JS_ThrowTypeError(ctx, "__getExport requires module and export name");
    const char* module = nullptr;
    if (!JS_IsNull(argv[0]) && !JS_IsUndefined(argv[0])) {
        module = JS_ToCString(ctx, argv[0]);
        if (!module) return JS_EXCEPTION;
    }
    const char* name = JS_ToCString(ctx, argv[1]);
    if (!name) { if (module) JS_FreeCString(ctx, module); return JS_EXCEPTION; }
    HMODULE handle = GetModuleHandleA(module);
    FARPROC address = handle ? GetProcAddress(handle, name) : nullptr;
    JSValue result = address ? JS_NewBigUint64(ctx, reinterpret_cast<uint64_t>(address))
                            : JS_ThrowReferenceError(ctx, "Export %s!%s is not loaded",
                                                     module ? module : "<main>", name);
    JS_FreeCString(ctx, name);
    if (module) JS_FreeCString(ctx, module);
    return result;
}

static bool Install(JSContext* ctx, JSValueConst global, const char* name, JSCFunction* fn, int arity) {
    JSValue value = JS_NewCFunction(ctx, fn, name, arity);
    if (JS_IsException(value)) return false;
    return JS_SetPropertyStr(ctx, global, name, value) >= 0;
}
} // namespace

bool InitializeMemoryBridge(JSContext* ctx) {
    JSRuntime* rt = JS_GetRuntime(ctx);
    JSClassID allocationClass = 0;
    JS_NewClassID(rt, &allocationClass);
    JSClassDef definition = {};
    definition.class_name = "NativeAllocation";
    definition.finalizer = AllocationFinalizer;
    if (JS_NewClass(rt, allocationClass, &definition) < 0) {
        JS_ThrowInternalError(ctx, "Cannot register NativeAllocation");
        return false;
    }
    JSValue global = JS_GetGlobalObject(ctx);
    if (JS_IsException(global)) return false;
    JSValue allocate = JS_NewCFunctionMagic(ctx, BridgeAlloc, "__alloc", 1,
                                            JS_CFUNC_generic_magic, static_cast<int>(allocationClass));
    bool ok = !JS_IsException(allocate);
    if (ok) ok = JS_SetPropertyStr(ctx, global, "__alloc", allocate) >= 0;
    ok = ok && Install(ctx, global, "__read", BridgeRead, 3)
            && Install(ctx, global, "__write", BridgeWrite, 3)
            && Install(ctx, global, "__nativeCall", BridgeNativeCall, 3)
            && Install(ctx, global, "__getExport", BridgeGetExport, 2);
    JS_FreeValue(ctx, global);
    return ok;
}
