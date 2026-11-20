# Building and changing the menu

## Build

On Windows, install Visual Studio 2022 or Build Tools 2022 with **Desktop development with C++**, including the Windows SDK and MASM. Put CMake 3.20+, Python 3.10+ and Node.js 22+ on PATH.

From the repository root:

```powershell
./scripts/build.ps1
```

The script downloads the pinned QuickJS-ng and MinHook source archives, checks their SHA-256 digests, builds Release/x64, runs the tests and writes:

```text
dist/WaterYouModding.bat
dist/SHA256SUMS.txt
```

The first build needs internet access for the two libraries. Later builds reuse `build/vendor`. Dependencies and licenses are listed in [third_party](third_party/README.md).

To package an existing Release build after changing only the launcher text or packaged README:

```powershell
python scripts/package.py
./dist/WaterYouModding.bat --check
```

`--check` verifies and extracts the package without attaching to the game. Changes to JavaScript must be bundled and compiled into the DLL again; use the full build script.

## Source map

| Path | Purpose |
| --- | --- |
| `src/mod/core.js` | Fishing, spawning, supplies, repair, disguises and noclip |
| `src/mod/ui.js` | In-game drawing, controls, item search and English/Russian text |
| `src/mod/catalog.json` | Item and fish names used by the menu |
| `src/native/native_host.cpp` | QuickJS host, game-thread dispatch, hooks and shutdown |
| `src/native/native_bridge.cpp` | Bounded memory access and Win64 native-call bridge |
| `src/native/shim.js` | JavaScript pointer, memory and native-call wrappers |
| `src/native/input_event_gate.h` | Per-seat input-event filtering during boat flight |
| `src/native/hud_hook.asm` | x64 HUD trampoline |
| `src/native/injector.cpp` | Running-game discovery and DLL loading |
| `scripts/build_bundle.py` | Catalog + settings + UI + core → embedded resource |
| `scripts/package.py`, `packaging/` | Self-extracting BAT and its end-user text |

## Runtime

The launcher finds the supported `WYDRO-Win64-Shipping.exe` process and loads `WydNative.dll`. The DLL checks the image size and hook-site bytes before installing hooks. It loads the bundled JavaScript into QuickJS and draws the menu through the game's HUD functions.

Gameplay calls run from the game-thread HUD callback. The worker handles command files and logs; it does not call Unreal gameplay functions. Reflected calls validate the target's class against the function owner before dispatch. Parameters use the layouts recovered from this build's reflection data.

Repair jobs pin their character, controller, boat and target identities. Taking the helm changes the possessed pawn to a seat, so the queue must stop rather than call a character Blueprint on the seat. Native errors also stop the queue.

Boat noclip requires host authority. It pauses hull simulation and buoyancy, moves the root without a sweep, and keeps deck collision enabled. The bow follows **negative local Y**, matching the game's horizontal `-GetRightVector()` movement direction. A/D changes yaw. The input gate suppresses only the local steering seat's action events, leaving inherited mouse-look input active. Release, focus loss, menu opening, possession changes and cleanup restore the saved state.

Original game calls can raise SEH exceptions. The outer hook wrappers use `__try / __finally` to balance active-callback counters even when ordinary C++ `/EHsc` unwinding would skip a destructor. Shutdown waits for callbacks to leave before freeing the runtime and hooks.

## Tests

The build runs:

- **Movement math:** speed limits, Shift, boat heading against a vector measured from the game, yaw-only turns, diagonal normalization and frame-time limits.
- **Repair regression:** possession/controller changes cancel before native dispatch; failed native calls clear the queue.
- **Bridge:** memory access, 64-bit precision, native calls, invalid pointers, lifetime across GC, and compilation of the bundled menu.
- **Input gate:** only the chosen pawn and action events are blocked; look input and other players pass through.
- **Callback lifetime:** wrappers extracted from production source are exercised through normal returns and raised SEH exceptions.

The first release was also tested in a live co-op session: item creation, storage deposits, fishing, visible giant fish and mushroom rain, character flight, boat flight, free mouse look and repeated seat interactions. Offline tests do not establish networking behavior on another game build.

## Updating for a new game build

Start with [offsets.md](docs/offsets.md) and [build-1.0.6.json](docs/build-1.0.6.json). The JSON is a reference document, not a runtime configuration file. The executable is not included.

Confirm the name/object tables, hook prologues, object layouts, function parameter sizes and relevant Blueprint behavior. Update the constants in the native host and core together. The repair class guard, ownership checks and cleanup paths must remain in place. Check ordinary seat, ladder and water transitions before testing movement changes.

## Local diagnostics

Settings and status are written under `%LOCALAPPDATA%\WaterYouModding\native-runtime`. While the mod is running, the optional developer helper sends a command through the local command file:

```powershell
python scripts/dev_command.py '{"op":"eval","code":"snapshot()"}'
```

The `eval` command runs inside the mod and can alter the game. No network listener is opened. Prefer read-only expressions when diagnosing a live session.

Do not run a different DLL build over an active one. Disable with F10 first; the launcher rejects a different loaded package before calling its entry point.
