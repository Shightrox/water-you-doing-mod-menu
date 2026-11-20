# Offsets for the inspected Win64 1.0.6 build

These are the values used by this mod, not a general Unreal Engine ABI. RVAs are relative to the main executable's loaded base; object-field offsets are relative to the object or struct named in the table. Process addresses from a particular run are not included.

## Executable

| Field | Value |
| --- | --- |
| Filename | `WYDRO-Win64-Shipping.exe` |
| Reported game version | `1.0.6` |
| Platform | Windows x64 |
| PE `SizeOfImage` | `152158208` bytes |
| SHA-256 of inspected file | `c570accd9c9e9466f43a597940daf06242249d5f2bfb6d686a761ee5353b1d18` |

The hash records the inspected file. Runtime startup checks image size and hook bytes, rather than hashing the executable on every launch.

## Module RVAs

| RVA | Use |
| --- | --- |
| `0x863D7D0` | FName block-pointer table used by `fname()` |
| `0x870B860` | Chunked UObject-array view used by `each()` and `valid()` |
| `0x14CEC00` | `ProcessInternal` hook; selected fishing events and seat input filtering |
| `0x3A6F04B` | HUD hook site; the trampoline preserves the original instructions and passes the HUD from RBX |

`ProcessEvent` is resolved from each object's vtable, slot **76**. The mod does not hard-code a process-specific function address.

## Reflection layout

| Base | Offset | Use |
| --- | --- | --- |
| UObject | `0x08` | Object flags |
| UObject | `0x0C` | Object index |
| UObject | `0x10` | Class pointer |
| UObject | `0x18` / `0x1C` | FName index / instance number |
| UObject | `0x20` | Outer pointer; UFunction owner class |
| UStruct / UClass | `0x40` | Super-struct / superclass |
| UStruct | `0x50` | First reflected field |
| FField | `0x08` | Field-class descriptor |
| FField | `0x18` | Next field |
| FField | `0x20` | Name |
| FProperty | `0x34` | Element size |
| FProperty | `0x44` | Member offset |
| UFunction | `0xB6` | Parameter-buffer size |
| FFrame | `0x10` | Executing function |
| FFrame | `0x28` | Locals / parameters used by the fishing hook |

The chunked object array uses 65,536 entries per chunk and a 24-byte entry stride; the object pointer is read at entry offset 8. `UDataTable` rows are read through the view at `+0x30`, with count at `+0x38` and a 24-byte row stride.

## Selected gameplay fields

Most fields are found by name at runtime. These recovered offsets are useful when following the direct reads in the core:

| Class | Field | Decimal offset |
| --- | --- | ---: |
| Actor | Owner | 344 |
| Actor | Local network role | 360 |
| Pawn | Controller | 736 |
| BP_WaterPlayerCharacter_C | Fishing component | 1744 |
| BP_WaterPlayerCharacter_C | Pickup component | 1816 |
| BP_WaterPlayerCharacter_C | Controlled harpoon | 1856 |
| BP_WaterPlayerCharacter_C | Swimming flag | 1872 |
| BP_WaterPlayerCharacter_C | Walk speed | 1944 |
| BP_WaterPlayerCharacter_C | Seat reference | 2352 |
| BP_WaterPlayerCharacter_C | Climbing flag | 2364 |
| BP_WaterPlayerCharacter_C | Ladder reference | 2368 |
| BP_SeatParent_C | CurrentPlayer | 904 |
| BP_SteeringSeat_C | BP_Boat | 1104 |
| BP_Boat_C | BoatPhysicsMesh | 2840 |
| BP_Boat_C | SmoothSync | 2848 |
| BP_Boat_C | Buoyancy | 2856 |

The implementation includes other direct field reads. Use [core.js](../src/mod/core.js) as the complete list and re-check them against reflection before porting. A valid pointer alone does not establish the correct class or a live gameplay object.

## Boat pose call

`Actor.K2_SetActorLocationAndRotation` uses double-precision vectors/rotators in this build:

| Parameter | Byte offset |
| --- | ---: |
| Location: X, Y, Z | 0, 8, 16 |
| Rotation: pitch, yaw, roll | 24, 32, 40 |
| Sweep | 48 |
| Hit result | 56 |
| Teleport | 312 |
| Return value | 313 |

The bow is local **-Y**, not +X. `noclipBoatHeading()` matches the horizontal projection of `-BoatPhysicsMesh.GetRightVector()` and accounts for the saved pitch and roll.
