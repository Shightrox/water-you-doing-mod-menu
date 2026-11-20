#pragma once
#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>

// Suppress only selected input-event wrappers on one locally controlled pawn.
// Look events, other objects and all unrelated Blueprint calls pass through.
class InputEventGate {
public:
    static constexpr size_t Capacity = 16;
    void Clear() { actor_.store(0, std::memory_order_release); }
    uint64_t BlockedCount() const { return blocked_.load(std::memory_order_relaxed); }
    void Set(uintptr_t actor, const std::array<uintptr_t, Capacity>& functions, size_t count) {
        Clear();
        if (!actor || !count || count > Capacity) return;
        for (size_t i = 0; i < count; ++i) functions_[i].store(functions[i], std::memory_order_relaxed);
        count_.store(count, std::memory_order_relaxed);
        actor_.store(actor, std::memory_order_release);
    }
    bool Blocks(uintptr_t actor, uintptr_t function) const {
        if (!actor || !function || actor_.load(std::memory_order_acquire) != actor) return false;
        const size_t count = count_.load(std::memory_order_relaxed);
        for (size_t i = 0; i < count; ++i)
            if (functions_[i].load(std::memory_order_relaxed) == function && actor_.load(std::memory_order_acquire) == actor) {
                blocked_.fetch_add(1, std::memory_order_relaxed);
                return true;
            }
        return false;
    }
private:
    std::atomic<uintptr_t> actor_{0};
    std::atomic<size_t> count_{0};
    std::array<std::atomic<uintptr_t>, Capacity> functions_{};
    mutable std::atomic<uint64_t> blocked_{0};
};
