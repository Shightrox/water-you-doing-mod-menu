#include "input_event_gate.h"
#include <cstdio>

int main() {
    InputEventGate gate;
    std::array<uintptr_t, InputEventGate::Capacity> actions{};
    constexpr uintptr_t seat = 100, otherSeat = 200, movement = 300, jump = 400, look = 500;
    actions[0] = movement; actions[1] = jump;
    int failures = 0, checks = 0;
    auto check = [&](bool ok, const char* message) { ++checks; if (!ok) { ++failures; std::printf("FAIL: %s\n", message); } };
    check(!gate.Blocks(seat, movement), "inactive gate passes inputs");
    gate.Set(seat, actions, 2);
    check(gate.Blocks(seat, movement) && gate.Blocks(seat, jump), "selected boat controls are blocked");
    check(!gate.Blocks(seat, look), "normal camera input passes");
    check(!gate.Blocks(otherSeat, movement), "other players are unaffected");
    check(!gate.Blocks(0, movement) && !gate.Blocks(seat, 0), "empty selectors pass");
    gate.Set(otherSeat, actions, 1);
    check(!gate.Blocks(seat, movement) && gate.Blocks(otherSeat, movement), "changing pawn releases previous pawn");
    check(!gate.Blocks(otherSeat, jump), "replaced action list has no stale entries");
    gate.Clear();
    check(!gate.Blocks(otherSeat, movement), "release restores normal input");
    gate.Set(seat, actions, 0);
    check(!gate.Blocks(seat, movement), "empty action list is disabled");
    std::printf("Input gate: %d checks, %d failures\n", checks, failures);
    return failures ? 1 : 0;
}
