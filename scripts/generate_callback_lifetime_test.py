"""Generate an offline SEH regression test using the production hook wrappers."""
from pathlib import Path
import hashlib

root = Path(__file__).resolve().parents[1]
source = (root / "src/native/native_host.cpp").read_text(encoding="utf-8")


def extract(signature: str) -> str:
    # Both production wrappers use a column-zero closing brace. Refuse ambiguous
    # matches rather than testing a different function or a stale copied body.
    needle = "\n" + signature
    if source.count(needle) != 1:
        raise RuntimeError(f"Expected exactly one wrapper: {signature}")
    start = source.index(needle) + 1
    end = source.index("\n}", start) + 2
    body = source[start:end]
    if "__try" not in body or "__finally" not in body:
        raise RuntimeError(f"Wrapper lost its SEH lifetime boundary: {signature}")
    return body


wrappers = "\n\n".join([
    extract("void __fastcall ProcessDetour("),
    extract("LRESULT WINAPI DispatchDetour("),
])
digest = hashlib.sha256(wrappers.encode()).hexdigest()
prefix = r'''
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <atomic>
#include <cstdio>

std::atomic<unsigned> g_callbacks{0};
static bool g_raise = false;
static bool g_bodyCounterCorrect = true;
static unsigned g_processCalls = 0, g_dispatchCalls = 0;
static const DWORD kFault = EXCEPTION_ACCESS_VIOLATION;
static const LRESULT kResult = static_cast<LRESULT>(0x123456789abcdefLL);

__declspec(noinline) void ProcessDetourBody(void*, void*, void*) {
    ++g_processCalls;
    g_bodyCounterCorrect = g_bodyCounterCorrect && g_callbacks.load() == 1;
    if (g_raise) RaiseException(kFault, 0, 0, nullptr);
}
__declspec(noinline) LRESULT DispatchDetourBody(const MSG*) {
    ++g_dispatchCalls;
    g_bodyCounterCorrect = g_bodyCounterCorrect && g_callbacks.load() == 1;
    if (g_raise) RaiseException(kFault, 0, 0, nullptr);
    return kResult;
}
'''
suffix = r'''

// These handlers deliberately live outside the production wrappers. They
// model the bridge catching an SEH that crossed a hooked original call.
static bool CatchProcessFault() {
    __try {
        ProcessDetour(nullptr, nullptr, nullptr);
        return false;
    } __except (GetExceptionCode() == kFault ? EXCEPTION_EXECUTE_HANDLER : EXCEPTION_CONTINUE_SEARCH) {
        return g_callbacks.load() == 0;
    }
}
static bool CatchDispatchFault() {
    __try {
        DispatchDetour(nullptr);
        return false;
    } __except (GetExceptionCode() == kFault ? EXCEPTION_EXECUTE_HANDLER : EXCEPTION_CONTINUE_SEARCH) {
        return g_callbacks.load() == 0;
    }
}
static unsigned g_checks = 0, g_failures = 0;
static void Check(bool ok, const char* name) {
    ++g_checks;
    std::printf("%s %s\n", ok ? "PASS" : "FAIL", name);
    if (!ok) ++g_failures;
}
int main() {
    ProcessDetour(nullptr, nullptr, nullptr);
    Check(g_callbacks.load() == 0 && g_processCalls == 1, "ProcessDetour normal return balances counter");
    LRESULT result = DispatchDetour(nullptr);
    Check(g_callbacks.load() == 0 && g_dispatchCalls == 1 && result == kResult,
          "DispatchDetour normal return balances counter and preserves LRESULT");
    g_raise = true;
    Check(CatchProcessFault() && g_processCalls == 2, "ProcessDetour SEH reaches outer handler with counter zero");
    Check(CatchDispatchFault() && g_dispatchCalls == 2, "DispatchDetour SEH reaches outer handler with counter zero");
    Check(g_bodyCounterCorrect, "Counter remains active throughout every body call");
    g_raise = false;
    ProcessDetour(nullptr, nullptr, nullptr);
    result = DispatchDetour(nullptr);
    Check(g_callbacks.load() == 0 && result == kResult && g_processCalls == 3 && g_dispatchCalls == 3,
          "Both wrappers remain balanced on subsequent normal calls");
    std::printf("%u checks, %u failures\n", g_checks, g_failures);
    return g_failures ? 1 : 0;
}
'''
out = root / "build/generated/callback_lifetime_tests.cpp"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(f"// Extracted production wrappers SHA-256: {digest}\n" + prefix + wrappers + suffix, encoding="utf-8")
print(f"Generated {out}")
print(f"Wrapper SHA-256: {digest}")
