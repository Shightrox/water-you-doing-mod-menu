#pragma once

#include "quickjs.h"

// Install the small memory/Win64-call API consumed by shim.js. On failure,
// returns false with a pending QuickJS exception. Call on the runtime's thread.
// Allocations belong to JS objects and are freed by the QuickJS finalizer;
// there is no process-global allocation pool or separate shutdown operation.
bool InitializeMemoryBridge(JSContext* ctx);
