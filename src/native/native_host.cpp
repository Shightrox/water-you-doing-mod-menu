// Windows x64 host for the bundled, transformed WYD JavaScript.
// Resource 101 (RCDATA) is UTF-8: native shim + catalog + UI + mod core.
// QuickJS is entered only under g_jsLock; message/file threads never run JS.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <tlhelp32.h>
#include <atomic>
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <deque>
#include <filesystem>
#include <mutex>
#include <stdexcept>
#include <string>
#include <unordered_set>
#include <vector>
#include "quickjs.h"
#include "MinHook.h"
#include "native_bridge.h"
#include "input_event_gate.h"

extern "C" {
void HudDetour();
void* g_HudTrampoline = nullptr;
volatile LONG g_HudActive = 0;
}

namespace {
constexpr uintptr_t kProcessOffset = 0x14cec00;
constexpr uintptr_t kHudOffset = 0x3a6f04b;
constexpr uint32_t kExpectedImageSize = 152158208;
constexpr size_t kMaxFile = 2 * 1024 * 1024;
enum Phase : LONG { Dormant, Starting, Running, Stopping };
HMODULE g_module = nullptr;
std::atomic<LONG> g_phase{Dormant};
std::atomic<bool> g_stop{false}, g_enabled{false}, g_firstHud{false};
std::atomic<unsigned> g_callbacks{0};
std::atomic<uintptr_t> g_fishTarget{0}, g_hookTarget{0};
InputEventGate g_inputGate;
INIT_ONCE g_locksOnce = INIT_ONCE_STATIC_INIT;
CRITICAL_SECTION g_jsLock;
unsigned g_jsDepth = 0; // Protected by the recursive critical section.
std::mutex g_queueLock;
HANDLE g_wake = nullptr, g_instanceMutex = nullptr;
JSRuntime* g_runtime = nullptr;
JSContext* g_context = nullptr;
JSValue g_hudFn = JS_UNDEFINED, g_fishFn = JS_UNDEFINED;
JSValue g_hookFn = JS_UNDEFINED, g_messageFn = JS_UNDEFINED;
uintptr_t g_base = 0;
uint32_t g_imageSize = 0;
void* g_processSite = nullptr;
void* g_hudSite = nullptr;
void* g_dispatchSite = nullptr;
using ProcessInternalFn = void (__fastcall*)(void*, void*, void*);
using DispatchFn = LRESULT (WINAPI*)(const MSG*);
ProcessInternalFn g_originalProcess = nullptr;
DispatchFn g_originalDispatch = nullptr;
bool g_mhInitialized = false, g_hudCreated = false;
bool g_processCreated = false, g_dispatchCreated = false;
std::filesystem::path g_directory;
std::string g_settings = "{}", g_lastCommand, g_lastJsError;
std::unordered_set<std::string> g_seenRequests;
std::deque<std::string> g_requestOrder;
struct Outgoing { std::string type, json, settings; };
std::deque<Outgoing> g_outgoing;
std::deque<std::string> g_commands;
std::deque<MSG> g_messages;

BOOL CALLBACK InitializeLocks(PINIT_ONCE, PVOID, PVOID*) {
    InitializeCriticalSection(&g_jsLock);
    return TRUE;
}
struct JsScope {
    JsScope() {
        EnterCriticalSection(&g_jsLock);
        if (g_jsDepth++ == 0 && g_runtime) JS_UpdateStackTop(g_runtime);
    }
    ~JsScope() { --g_jsDepth; LeaveCriticalSection(&g_jsLock); }
};

std::wstring Environment(const wchar_t* name) {
    DWORD size = GetEnvironmentVariableW(name, nullptr, 0);
    if (!size || size > 32768) return {};
    std::wstring value(size, L'\0');
    DWORD actual = GetEnvironmentVariableW(name, value.data(), size);
    if (!actual || actual >= size) return {};
    value.resize(actual);
    return value;
}
std::string JsonEscape(const std::string& s) {
    std::string out;
    static constexpr char hex[] = "0123456789abcdef";
    for (unsigned char c : s) {
        if (c == '"' || c == '\\') { out += '\\'; out += char(c); }
        else if (c < 32) { out += "\\u00"; out += hex[c >> 4]; out += hex[c & 15]; }
        else out += char(c);
    }
    return out;
}
std::string ReadFile(const wchar_t* name) {
    const auto file = g_directory / name;
    HANDLE h = CreateFileW(file.c_str(), GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
        OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return {};
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(h, &size) || size.QuadPart < 0 || size.QuadPart > kMaxFile) {
        CloseHandle(h); return {};
    }
    std::string value(static_cast<size_t>(size.QuadPart), '\0');
    DWORD got = 0;
    BOOL ok = value.empty() || ::ReadFile(h, value.data(), DWORD(value.size()), &got, nullptr);
    CloseHandle(h);
    if (!ok || (!value.empty() && got != value.size())) return {};
    if (value.size() >= 3 && value.compare(0, 3, "\xef\xbb\xbf") == 0) value.erase(0, 3);
    return value;
}
bool WriteAtomic(const wchar_t* name, const std::string& value) {
    if (g_directory.empty()) return false;
    const auto target = g_directory / name;
    auto temporary = target;
    temporary += L".tmp." + std::to_wstring(GetCurrentProcessId());
    HANDLE h = CreateFileW(temporary.c_str(), GENERIC_WRITE, FILE_SHARE_READ,
        nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    DWORD written = 0;
    bool ok = WriteFile(h, value.data(), DWORD(value.size()), &written, nullptr) && written == value.size();
    CloseHandle(h);
    if (ok) ok = !!MoveFileExW(temporary.c_str(), target.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);
    if (!ok) DeleteFileW(temporary.c_str());
    return ok;
}
void AppendLog(const std::string& json) {
    if (g_directory.empty()) return;
    const auto file = g_directory / L"mod-log.jsonl";
    HANDLE h = CreateFileW(file.c_str(), FILE_APPEND_DATA,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
        OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return;
    const std::string line = json + "\n";
    DWORD written;
    WriteFile(h, line.data(), DWORD(line.size()), &written, nullptr);
    CloseHandle(h);
}
void Startup(const char* state, const std::string& message = {}) {
    WriteAtomic(L"startup.json", "{\"state\":\"" + std::string(state) +
        "\",\"pid\":" + std::to_string(GetCurrentProcessId()) +
        ",\"runtime\":\"native\",\"message\":\"" + JsonEscape(message) + "\"}");
}
void Enqueue(Outgoing event) {
    {
        std::lock_guard<std::mutex> lock(g_queueLock);
        if (g_outgoing.size() >= 4096) g_outgoing.pop_front();
        g_outgoing.push_back(std::move(event));
    }
    if (g_wake) SetEvent(g_wake);
}
void NativeLog(const char* where, const std::string& message) noexcept {
    try {
        Enqueue({"error", "{\"type\":\"error\",\"where\":\"" + JsonEscape(where) +
            "\",\"message\":\"" + JsonEscape(message) + "\"}", {}});
    } catch (...) {} // Logging must never throw across a game/Win32 detour.
}
void FlushOutgoing() {
    std::deque<Outgoing> pending;
    { std::lock_guard<std::mutex> lock(g_queueLock); pending.swap(g_outgoing); }
    for (const auto& event : pending) {
        AppendLog(event.json);
        if (event.type == "status") WriteAtomic(L"mod-status.json", event.json);
        if (event.type == "result") WriteAtomic(L"mod-result.json", event.json);
        if (!event.settings.empty()) WriteAtomic(L"mod-settings.json", event.settings);
    }
}
std::string JsString(JSContext* ctx, JSValueConst value) {
    size_t length = 0;
    const char* p = JS_ToCStringLen(ctx, &length, value);
    if (!p) return {};
    std::string result(p, length);
    JS_FreeCString(ctx, p);
    return result;
}
std::string Stringify(JSContext* ctx, JSValueConst value) {
    JSValue json = JS_JSONStringify(ctx, value, JS_UNDEFINED, JS_UNDEFINED);
    if (JS_IsException(json)) return {};
    std::string text = JS_IsUndefined(json) ? "null" : JsString(ctx, json);
    JS_FreeValue(ctx, json);
    return text;
}
std::string TakeException(JSContext* ctx) {
    JSValue exception = JS_GetException(ctx);
    std::string text = JsString(ctx, exception);
    if (JS_IsObject(exception)) {
        JSValue stack = JS_GetPropertyStr(ctx, exception, "stack");
        if (JS_IsString(stack)) text += "\n" + JsString(ctx, stack);
        JS_FreeValue(ctx, stack);
    }
    JS_FreeValue(ctx, exception);
    return text.empty() ? "JavaScript exception" : text;
}
void ReportException(const char* where) {
    std::string error = TakeException(g_context);
    if (error != g_lastJsError) { g_lastJsError = error; NativeLog(where, error); }
}
bool CallJs(JSValueConst fn, int argc = 0, JSValueConst* argv = nullptr) {
    if (!g_context || !JS_IsFunction(g_context, fn)) return false;
    JSValue result = JS_Call(g_context, fn, JS_UNDEFINED, argc, argv);
    if (JS_IsException(result)) { ReportException("callback"); return false; }
    JS_FreeValue(g_context, result);
    return true;
}
bool SetCallback(JSContext* ctx, JSValue& storage, JSValueConst value) {
    if (!JS_IsNull(value) && !JS_IsUndefined(value) && !JS_IsFunction(ctx, value)) {
        JS_ThrowTypeError(ctx, "callback must be a function or null"); return false;
    }
    JS_FreeValue(ctx, storage);
    storage = JS_DupValue(ctx, value);
    return true;
}
JSValue RegisterHud(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 1) return JS_ThrowTypeError(ctx, "__registerHud(callback)");
    return SetCallback(ctx, g_hudFn, argv[0]) ? JS_UNDEFINED : JS_EXCEPTION;
}
JSValue RegisterMessage(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 1) return JS_ThrowTypeError(ctx, "__registerMessage(callback)");
    return SetCallback(ctx, g_messageFn, argv[0]) ? JS_UNDEFINED : JS_EXCEPTION;
}
JSValue RegisterProcess(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc != 4) return JS_ThrowTypeError(ctx, "__registerProcess(fish, tick, fishCallback, tickCallback)");
    uint64_t fish = 0, hook = 0;
    if (JS_ToBigUint64(ctx, &fish, argv[0]) < 0 || JS_ToBigUint64(ctx, &hook, argv[1]) < 0) return JS_EXCEPTION;
    if (!SetCallback(ctx, g_fishFn, argv[2]) || !SetCallback(ctx, g_hookFn, argv[3])) return JS_EXCEPTION;
    g_fishTarget.store(uintptr_t(fish), std::memory_order_release);
    g_hookTarget.store(uintptr_t(hook), std::memory_order_release);
    return JS_UNDEFINED;
}
JSValue SetInputGate(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc != 2 || !JS_IsArray(argv[1])) return JS_ThrowTypeError(ctx, "__setInputGate(actor, functions[])");
    uint64_t actor = 0;
    if (JS_ToBigUint64(ctx, &actor, argv[0]) < 0) return JS_EXCEPTION;
    JSValue length = JS_GetPropertyStr(ctx, argv[1], "length");
    uint32_t count = 0;
    const int status = JS_ToUint32(ctx, &count, length);
    JS_FreeValue(ctx, length);
    if (status < 0) return JS_EXCEPTION;
    if (count > InputEventGate::Capacity) return JS_ThrowRangeError(ctx, "Too many gated input events");
    std::array<uintptr_t, InputEventGate::Capacity> functions{};
    for (uint32_t i = 0; i < count; ++i) {
        JSValue value = JS_GetPropertyUint32(ctx, argv[1], i);
        uint64_t function = 0;
        const int converted = JS_ToBigUint64(ctx, &function, value);
        JS_FreeValue(ctx, value);
        if (converted < 0) return JS_EXCEPTION;
        if (!function) return JS_ThrowTypeError(ctx, "Input event must be nonzero");
        functions[i] = uintptr_t(function);
    }
    g_inputGate.Set(uintptr_t(actor), functions, count);
    return JS_UNDEFINED;
}
JSValue InputGateBlockedCount(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    return JS_NewFloat64(ctx, double(g_inputGate.BlockedCount()));
}
JSValue Send(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc != 1 || !JS_IsString(argv[0])) return JS_ThrowTypeError(ctx, "__send expects JSON text");
    std::string json = JsString(ctx, argv[0]);
    if (json.size() > kMaxFile) return JS_ThrowRangeError(ctx, "message too large");
    JSValue object = JS_ParseJSON(ctx, json.data(), json.size(), "__send");
    if (JS_IsException(object)) return JS_EXCEPTION;
    JSValue type = JS_GetPropertyStr(ctx, object, "type");
    std::string kind = JS_IsString(type) ? JsString(ctx, type) : "log";
    JS_FreeValue(ctx, type);
    std::string settings;
    if (kind == "config" || kind == "status") {
        JSValue config = JS_GetPropertyStr(ctx, object, "config");
        if (JS_IsObject(config)) settings = Stringify(ctx, config);
        JS_FreeValue(ctx, config);
        if (!settings.empty()) g_settings = settings;
    }
    JS_FreeValue(ctx, object);
    Enqueue({kind, std::move(json), std::move(settings)});
    if (kind == "stopped") g_stop.store(true, std::memory_order_release);
    return JS_UNDEFINED;
}
JSValue Settings(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    return JS_NewStringLen(ctx, g_settings.data(), g_settings.size());
}
void RegisterFunction(JSValueConst global, const char* name, JSCFunction* fn, int argc) {
    JS_SetPropertyStr(g_context, global, name, JS_NewCFunction(g_context, fn, name, argc));
}

// Keep SEH in leaf POD-only helpers, separate from functions with C++ unwinding.
uintptr_t FrameFunction(void* frame) {
    __try { return frame ? *reinterpret_cast<uintptr_t*>(static_cast<uint8_t*>(frame) + 16) : 0; }
    __except (EXCEPTION_EXECUTE_HANDLER) { return 0; }
}
bool CopyMessage(const MSG* input, MSG* output) {
    __try { *output = *input; return true; }
    __except (EXCEPTION_EXECUTE_HANDLER) { return false; }
}
bool ImageInfo(HMODULE image, uint32_t* size) {
    __try {
        auto dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(image);
        if (dos->e_magic != IMAGE_DOS_SIGNATURE || dos->e_lfanew < 0 || dos->e_lfanew > 0x100000) return false;
        auto nt = reinterpret_cast<const IMAGE_NT_HEADERS64*>(reinterpret_cast<const uint8_t*>(image) + dos->e_lfanew);
        if (nt->Signature != IMAGE_NT_SIGNATURE || nt->FileHeader.Machine != IMAGE_FILE_MACHINE_AMD64 || nt->OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR64_MAGIC) return false;
        *size = nt->OptionalHeader.SizeOfImage;
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) { return false; }
}
bool Matches(void* address, const uint8_t* bytes, size_t size) {
    __try { return std::memcmp(address, bytes, size) == 0; }
    __except (EXCEPTION_EXECUTE_HANDLER) { return false; }
}

__declspec(noinline) void ProcessDetourBody(void* object, void* frame, void* result) {
    const uintptr_t function = FrameFunction(frame);
    if (g_enabled.load(std::memory_order_acquire) && !g_stop.load(std::memory_order_acquire) &&
        g_inputGate.Blocks(reinterpret_cast<uintptr_t>(object), function)) return;
    if (g_enabled.load(std::memory_order_acquire) && !g_stop.load(std::memory_order_acquire) && function &&
        (function == g_fishTarget.load(std::memory_order_acquire) || function == g_hookTarget.load(std::memory_order_acquire))) {
        try {
            JsScope js;
            if (g_context && !g_stop.load(std::memory_order_acquire)) {
                JSValue args[] = { JS_NewBigUint64(g_context, reinterpret_cast<uintptr_t>(object)),
                    JS_NewBigUint64(g_context, reinterpret_cast<uintptr_t>(frame)) };
                if (function == g_fishTarget.load(std::memory_order_acquire)) CallJs(g_fishFn, 2, args);
                else CallJs(g_hookFn, 1, args);
                JS_FreeValue(g_context, args[0]); JS_FreeValue(g_context, args[1]);
            }
        } catch (...) { NativeLog("ProcessInternal", "C++ exception in callback"); }
    }
    // Always preserve the game's original operation, including during shutdown.
    g_originalProcess(object, frame, result);
}
// An exception in the original game call can unwind through this hook into
// the bridge's SEH handler. /EHsc does not run C++ destructors for SEH, so the
// activity counter must use an explicit termination handler. Keep this outer
// frame POD-only and the C++/JS scopes in the non-inlined body.
void __fastcall ProcessDetour(void* object, void* frame, void* result) {
    g_callbacks.fetch_add(1, std::memory_order_acq_rel);
    __try {
        ProcessDetourBody(object, frame, result);
    } __finally {
        g_callbacks.fetch_sub(1, std::memory_order_acq_rel);
    }
}
__declspec(noinline) LRESULT DispatchDetourBody(const MSG* message) {
    if (g_enabled.load(std::memory_order_acquire) && !g_stop.load(std::memory_order_acquire)) {
        MSG copy{};
        if (message && CopyMessage(message, &copy) && (copy.message == WM_CHAR || copy.message == WM_MOUSEWHEEL)) {
            try {
                std::lock_guard<std::mutex> lock(g_queueLock);
                if (g_messages.size() < 512) g_messages.push_back(copy);
            } catch (...) {} // Never interfere with dispatch because of a full queue/OOM.
        }
    }
    return g_originalDispatch(message);
}
LRESULT WINAPI DispatchDetour(const MSG* message) {
    LRESULT result = 0;
    g_callbacks.fetch_add(1, std::memory_order_acq_rel);
    __try {
        result = DispatchDetourBody(message);
    } __finally {
        g_callbacks.fetch_sub(1, std::memory_order_acq_rel);
    }
    return result;
}

void DrainMessagesAndCommands() {
    std::deque<MSG> messages;
    std::deque<std::string> commands;
    { std::lock_guard<std::mutex> lock(g_queueLock); messages.swap(g_messages); commands.swap(g_commands); }
    for (auto& message : messages) {
        if (g_stop.load(std::memory_order_acquire)) break;
        JSValue arg = JS_NewBigUint64(g_context, reinterpret_cast<uintptr_t>(&message));
        CallJs(g_messageFn, 1, &arg);
        JS_FreeValue(g_context, arg);
    }
    for (const auto& text : commands) {
        if (g_stop.load(std::memory_order_acquire)) break;
        JSValue command = JS_ParseJSON(g_context, text.data(), text.size(), "mod-command.json");
        if (JS_IsException(command)) { ReportException("command-json"); continue; }
        JSValue request = JS_GetPropertyStr(g_context, command, "request");
        const bool hasRequest = JS_IsString(request) || JS_IsNumber(request);
        std::string token = hasRequest ? Stringify(g_context, request) : std::string();
        JS_FreeValue(g_context, request);
        if (!hasRequest || token.empty() || g_seenRequests.count(token)) { JS_FreeValue(g_context, command); continue; }
        g_seenRequests.insert(token);
        g_requestOrder.push_back(token);
        if (g_requestOrder.size() > 1024) { g_seenRequests.erase(g_requestOrder.front()); g_requestOrder.pop_front(); }
        JSValue global = JS_GetGlobalObject(g_context);
        JSValue fn = JS_GetPropertyStr(g_context, global, "__wydCommand");
        CallJs(fn, 1, &command);
        JS_FreeValue(g_context, fn); JS_FreeValue(g_context, global); JS_FreeValue(g_context, command);
    }
}
bool InitializeJavaScript(std::string& error) {
    HRSRC resource = FindResourceW(g_module, MAKEINTRESOURCEW(101), MAKEINTRESOURCEW(10));
    HGLOBAL loaded = resource ? LoadResource(g_module, resource) : nullptr;
    const char* script = loaded ? static_cast<const char*>(LockResource(loaded)) : nullptr;
    DWORD length = resource ? SizeofResource(g_module, resource) : 0;
    if (!script || !length) { error = "Missing JavaScript RCDATA resource 101"; return false; }
    // QuickJS expects source[length] == '\0', which a raw PE resource does not guarantee.
    std::string source(script, length);
    while (!source.empty() && source.back() == '\0') source.pop_back();
    g_runtime = JS_NewRuntime();
    if (!g_runtime) { error = "JS_NewRuntime failed"; return false; }
    JS_SetMemoryLimit(g_runtime, 256 * 1024 * 1024);
    JS_SetMaxStackSize(g_runtime, 768 * 1024);
    g_context = JS_NewContext(g_runtime);
    if (!g_context) { error = "JS_NewContext failed"; return false; }
    JsScope js;
    if (!InitializeMemoryBridge(g_context)) { error = TakeException(g_context); return false; }
    JSValue global = JS_GetGlobalObject(g_context);
    JS_SetPropertyStr(g_context, global, "__base", JS_NewBigUint64(g_context, g_base));
    JS_SetPropertyStr(g_context, global, "__size", JS_NewUint32(g_context, g_imageSize));
    JS_SetPropertyStr(g_context, global, "__pid", JS_NewUint32(g_context, GetCurrentProcessId()));
    RegisterFunction(global, "__registerHud", RegisterHud, 1);
    RegisterFunction(global, "__registerProcess", RegisterProcess, 4);
    RegisterFunction(global, "__setInputGate", SetInputGate, 2);
    RegisterFunction(global, "__inputGateBlockedCount", InputGateBlockedCount, 0);
    RegisterFunction(global, "__registerMessage", RegisterMessage, 1);
    RegisterFunction(global, "__send", Send, 1);
    RegisterFunction(global, "__settings", Settings, 0);
    JS_FreeValue(g_context, global);
    JSValue result = JS_Eval(g_context, source.c_str(), source.size(), "wyd-native.js", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(result)) { error = TakeException(g_context); return false; }
    JS_FreeValue(g_context, result);
    if (!JS_IsFunction(g_context, g_hudFn)) { error = "Bundled script did not register a HUD callback"; return false; }
    return true;
}
void FreeJavaScript() {
    JsScope js;
    if (g_context) {
        for (JSValue* fn : {&g_hudFn, &g_fishFn, &g_hookFn, &g_messageFn}) {
            JS_FreeValue(g_context, *fn); *fn = JS_UNDEFINED;
        }
        JS_FreeContext(g_context); g_context = nullptr;
    }
    if (g_runtime) { JS_FreeRuntime(g_runtime); g_runtime = nullptr; }
    g_fishTarget.store(0); g_hookTarget.store(0);
    g_inputGate.Clear();
}
bool CheckHooks(std::string& error) {
    HMODULE game = GetModuleHandleW(nullptr);
    if (!ImageInfo(game, &g_imageSize) || g_imageSize != kExpectedImageSize) {
        error = "Unsupported game image: expected SizeOfImage 152158208"; return false;
    }
    g_base = reinterpret_cast<uintptr_t>(game);
    g_processSite = reinterpret_cast<void*>(g_base + kProcessOffset);
    g_hudSite = reinterpret_cast<void*>(g_base + kHudOffset);
    static constexpr uint8_t processBytes[] = {0x48,0x89,0x5c,0x24,0x08,0x48,0x89,0x6c,0x24,0x10};
    static constexpr uint8_t hudBytes[] = {0x48,0x8b,0x9c,0x24,0xb8,0x00,0x00,0x00,0x48,0x81,0xc4,0xa0,0x00,0x00,0x00,0x5f,0xc3};
    if (!Matches(g_processSite, processBytes, sizeof(processBytes)) || !Matches(g_hudSite, hudBytes, sizeof(hudBytes))) {
        error = "Hook bytes do not match this build. Fully stop the previous Frida/native mod before loading.";
        return false;
    }
    return true;
}
bool InstallHooks(std::string& error) {
    auto require = [&](MH_STATUS status, const char* operation) {
        if (status == MH_OK) return true;
        error = std::string(operation) + ": " + MH_StatusToString(status); return false;
    };
    if (!require(MH_Initialize(), "MH_Initialize")) return false;
    g_mhInitialized = true;
    if (!require(MH_CreateHook(g_hudSite, reinterpret_cast<void*>(&HudDetour), &g_HudTrampoline), "Create HUD hook")) return false;
    g_hudCreated = true;
    if (!require(MH_CreateHook(g_processSite, reinterpret_cast<void*>(&ProcessDetour), reinterpret_cast<void**>(&g_originalProcess)), "Create ProcessInternal hook")) return false;
    g_processCreated = true;
    if (!require(MH_CreateHookApiEx(L"user32.dll", "DispatchMessageW", reinterpret_cast<void*>(&DispatchDetour), reinterpret_cast<void**>(&g_originalDispatch), &g_dispatchSite), "Create DispatchMessage hook")) return false;
    g_dispatchCreated = true;
    // Registering all callbacks precedes enabling any detour.
    if (!require(MH_QueueEnableHook(g_hudSite), "Queue HUD") ||
        !require(MH_QueueEnableHook(g_processSite), "Queue ProcessInternal") ||
        !require(MH_QueueEnableHook(g_dispatchSite), "Queue DispatchMessage")) return false;
    if (!require(MH_ApplyQueued(), "Enable hooks")) return false;
    g_enabled.store(true, std::memory_order_release);
    return true;
}

bool DisableHooks() {
    g_enabled.store(false, std::memory_order_release);
    if (!g_mhInitialized) return true;
    bool ok = true;
    for (void* target : {g_hudCreated ? g_hudSite : nullptr, g_processCreated ? g_processSite : nullptr, g_dispatchCreated ? g_dispatchSite : nullptr}) {
        if (!target) continue;
        MH_STATUS status = MH_DisableHook(target);
        if (status != MH_OK && status != MH_ERROR_DISABLED) ok = false;
    }
    return ok;
}
struct AddressRange { uintptr_t start, end; };
std::vector<AddressRange> ExecutableRanges() {
    std::vector<AddressRange> ranges;
    uint32_t size = 0;
    if (ImageInfo(g_module, &size)) ranges.push_back({reinterpret_cast<uintptr_t>(g_module), reinterpret_cast<uintptr_t>(g_module) + size});
    for (void* p : {g_HudTrampoline, reinterpret_cast<void*>(g_originalProcess), reinterpret_cast<void*>(g_originalDispatch)}) {
        MEMORY_BASIC_INFORMATION info{};
        if (p && VirtualQuery(p, &info, sizeof(info))) ranges.push_back({reinterpret_cast<uintptr_t>(info.BaseAddress), reinterpret_cast<uintptr_t>(info.BaseAddress) + info.RegionSize});
    }
    return ranges;
}
// Disabling a hook prevents new entrants but does not cover an assembly epilogue
// after its active counter was decremented. Inspect RIP only at shutdown, while
// other threads are briefly suspended. We never free code on an uncertain result.
bool VerifyQuiescent(const std::vector<AddressRange>& ranges) {
    if (g_callbacks.load(std::memory_order_acquire) || InterlockedCompareExchange(&g_HudActive, 0, 0)) return false;
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return false;
    std::vector<HANDLE> threads;
    THREADENTRY32 entry{sizeof(entry)};
    bool ok = !!Thread32First(snapshot, &entry);
    if (ok) do {
        if (entry.th32OwnerProcessID != GetCurrentProcessId() || entry.th32ThreadID == GetCurrentThreadId()) continue;
        HANDLE thread = OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT | THREAD_QUERY_INFORMATION, FALSE, entry.th32ThreadID);
        if (!thread) { if (GetLastError() != ERROR_INVALID_PARAMETER) ok = false; continue; }
        threads.push_back(thread);
    } while (Thread32Next(snapshot, &entry));
    CloseHandle(snapshot);
    // All allocations occur before suspension: no allocator/heap lock waits while
    // another thread may be suspended inside that allocator.
    size_t suspended = 0;
    for (; suspended < threads.size(); ++suspended) {
        if (SuspendThread(threads[suspended]) == DWORD(-1)) { ok = false; break; }
        CONTEXT context{}; context.ContextFlags = CONTEXT_CONTROL;
        if (!GetThreadContext(threads[suspended], &context)) ok = false;
        else for (const auto& range : ranges) if (context.Rip >= range.start && context.Rip < range.end) ok = false;
    }
    if (g_callbacks.load(std::memory_order_acquire) || InterlockedCompareExchange(&g_HudActive, 0, 0)) ok = false;
    for (size_t i = 0; i < suspended; ++i) ResumeThread(threads[i]);
    for (HANDLE thread : threads) CloseHandle(thread);
    return ok;
}
bool DrainHooks() {
    try {
        auto ranges = ExecutableRanges();
        if (ranges.empty()) return false;
        for (unsigned attempt = 0; attempt != 24; ++attempt) {
            if (VerifyQuiescent(ranges)) return true;
            Sleep(25);
        }
    } catch (...) {} // An uncertain shutdown must retain, never free, callback code.
    return false;
}
void RemoveHooks() {
    if (g_mhInitialized) MH_Uninitialize();
    g_mhInitialized = g_hudCreated = g_processCreated = g_dispatchCreated = false;
    g_HudTrampoline = nullptr; g_originalProcess = nullptr; g_originalDispatch = nullptr;
    g_processSite = g_hudSite = g_dispatchSite = nullptr;
}
void PollCommand() {
    std::string command = ReadFile(L"mod-command.json");
    if (command.empty() || command == g_lastCommand) return;
    g_lastCommand = command;
    std::lock_guard<std::mutex> lock(g_queueLock);
    if (g_commands.size() < 64) g_commands.push_back(std::move(command));
}
void ResetSession() {
    g_stop.store(false); g_enabled.store(false); g_firstHud.store(false);
    g_lastJsError.clear(); g_seenRequests.clear(); g_requestOrder.clear();
    std::lock_guard<std::mutex> lock(g_queueLock);
    g_messages.clear(); g_commands.clear(); g_outgoing.clear();
}
void CloseSessionHandles() {
    if (g_wake) { CloseHandle(g_wake); g_wake = nullptr; }
    if (g_instanceMutex) { CloseHandle(g_instanceMutex); g_instanceMutex = nullptr; }
}
struct WorkerResult { DWORD code; bool unload; };
WorkerResult WorkerSession() {
    bool safe = false;
    std::string failure;
    try {
        InitOnceExecuteOnce(&g_locksOnce, InitializeLocks, nullptr, nullptr);
        if (g_mhInitialized || g_context || g_runtime) {
            // Restart after a conservative retained stop. Old callbacks and their
            // allocator state must be gone before any session globals are reset.
            if (!DisableHooks() || !DrainHooks()) {
                Startup("stopped-retained", "A previous callback is still returning; try launching again");
                g_phase.store(Dormant, std::memory_order_release);
                return {ERROR_BUSY, false};
            }
            FlushOutgoing();
            RemoveHooks();
            FreeJavaScript();
            CloseSessionHandles();
        }
        const std::wstring overridePath = Environment(L"WYD_NATIVE_RUNTIME");
        const std::wstring local = Environment(L"LOCALAPPDATA");
        if (overridePath.empty() && local.empty()) throw std::runtime_error("LOCALAPPDATA is unavailable");
        g_directory = overridePath.empty() ? std::filesystem::path(local) / L"WaterYouModding" / L"native-runtime" : std::filesystem::path(overridePath);
        std::filesystem::create_directories(g_directory);
        std::wstring mutexName = L"Local\\WaterYouModding.Native." + std::to_wstring(GetCurrentProcessId());
        // Existence, not mutex ownership, is the duplicate-instance guard. The
        // handle can be carried across worker threads during a retained stop.
        g_instanceMutex = CreateMutexW(nullptr, FALSE, mutexName.c_str());
        if (!g_instanceMutex) throw std::runtime_error("CreateMutex failed");
        if (GetLastError() == ERROR_ALREADY_EXISTS) {
            CloseHandle(g_instanceMutex); g_instanceMutex = nullptr;
            // A second DLL copy must not overwrite the active host's ready file.
            return {ERROR_ALREADY_EXISTS, true};
        }
        ResetSession();
        g_wake = CreateEventW(nullptr, FALSE, FALSE, nullptr);
        if (!g_wake) throw std::runtime_error("CreateEvent failed");
        g_settings = ReadFile(L"mod-settings.json"); if (g_settings.empty()) g_settings = "{}";
        g_lastCommand = ReadFile(L"mod-command.json"); // Do not replay a stale stop/issue command on reload.
        Startup("initializing");
        if (!CheckHooks(failure)) throw std::runtime_error(failure);
        if (!InitializeJavaScript(failure)) throw std::runtime_error(failure);
        if (!InstallHooks(failure)) throw std::runtime_error(failure);
        g_phase.store(Running, std::memory_order_release);
        Startup("waiting-hud", "Hooks installed; waiting for the first HUD callback");
        bool ready = false;
        while (!g_stop.load(std::memory_order_acquire)) {
            FlushOutgoing();
            PollCommand();
            if (!ready && g_firstHud.load(std::memory_order_acquire)) { ready = true; Startup("ready"); }
            WaitForSingleObject(g_wake, 40);
        }
    } catch (const std::exception& error) { failure = error.what(); }
      catch (...) { failure = "Unexpected native host initialization failure"; }
    g_phase.store(Stopping, std::memory_order_release);
    g_stop.store(true, std::memory_order_release);
    const bool disabled = DisableHooks();
    safe = disabled && DrainHooks();
    FlushOutgoing();
    if (!failure.empty()) { AppendLog("{\"type\":\"error\",\"where\":\"native-host\",\"message\":\"" + JsonEscape(failure) + "\"}"); Startup("error", failure); }
    if (!safe) {
        // Leave context/trampolines and DLL resident if a callback's return path
        // cannot be proved clear. WydStart will retry shutdown before restarting.
        Startup("stopped-retained", failure.empty() ? "Hooks disabled; waiting to confirm a safe unload" : failure);
        // Keep both handles alive too: an old callback may still enqueue a final
        // error, and another DLL copy must not install over this retained host.
        g_phase.store(Dormant, std::memory_order_release);
        return {0, false};
    }
    RemoveHooks();
    FreeJavaScript();
    FlushOutgoing();
    if (failure.empty()) Startup("stopped");
    CloseSessionHandles();
    return {failure.empty() ? DWORD(0) : DWORD(1), true};
}
DWORD WINAPI Worker(void*) {
    try {
        // Let every C++ local destruct before unloading this image/thread.
        const WorkerResult result = WorkerSession();
        if (result.unload) FreeLibraryAndExitThread(g_module, result.code);
        return result.code;
    } catch (...) {
        // A shutdown allocation/I/O exception must not unwind into CreateThread
        // or cause the game process to terminate. Retain the disabled host.
        g_stop.store(true, std::memory_order_release);
        DisableHooks();
        try { Startup("stopped-retained", "Native shutdown could not complete; retry the launcher"); } catch (...) {}
        g_phase.store(Dormant, std::memory_order_release);
        return ERROR_GEN_FAILURE;
    }
}
} // namespace

extern "C" void OnHud(void* hud) {
    // g_HudActive is maintained by MASM through the register/flags epilogue.
    if (!g_enabled.load(std::memory_order_acquire) || g_stop.load(std::memory_order_acquire)) return;
    try {
        JsScope js;
        if (!g_context || g_stop.load(std::memory_order_acquire)) return;
        DrainMessagesAndCommands();
        if (g_stop.load(std::memory_order_acquire)) return;
        JSValue arg = JS_NewBigUint64(g_context, reinterpret_cast<uintptr_t>(hud));
        const bool ok = CallJs(g_hudFn, 1, &arg);
        JS_FreeValue(g_context, arg);
        if (ok) g_firstHud.store(true, std::memory_order_release);
    } catch (...) { NativeLog("HUD", "C++ exception in callback"); }
}

extern "C" __declspec(dllexport) DWORD WINAPI WydStart(void*) {
    LONG expected = Dormant;
    if (!g_phase.compare_exchange_strong(expected, Starting, std::memory_order_acq_rel)) return ERROR_ALREADY_EXISTS;
    // A retained session, if any, is drained and released by Worker before reset.
    HANDLE thread = CreateThread(nullptr, 0, Worker, nullptr, 0, nullptr);
    if (!thread) { DWORD error = GetLastError(); g_phase.store(Dormant); return error; }
    CloseHandle(thread);
    return 0;
}
BOOL WINAPI DllMain(HINSTANCE module, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        g_module = module;
        DisableThreadLibraryCalls(module);
        WydStart(nullptr);
    }
    return TRUE;
}
