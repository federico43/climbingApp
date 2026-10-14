# DIY Force Gauge (ESP32 "Tindeq") — Bluetooth Plan

Status: **draft, awaiting approval**. Nothing implemented yet.

## Goal
Stream live force from the ESP32 load-cell device into the app over BLE, with tare,
start/stop and battery, so it can later drive max-pull / repeaters / critical-force
tests and feed the S&C progression engine.

## Protocol decision
The ESP32 emulates the **Tindeq Progressor** GATT protocol, so:
- firmware can be verified with the official Tindeq app before any app code exists;
- the app code also works with a real Tindeq.

| Item | UUID / value |
|---|---|
| Service | `7e4e1701-1ea6-40c9-9dcc-13d34ffead57` |
| Data (notify) | `7e4e1702-1ea6-40c9-9dcc-13d34ffead57` |
| Control point (write) | `7e4e1703-1ea6-40c9-9dcc-13d34ffead57` |

Control commands (1 byte opcode): `0x64` tare · `0x65` start weight stream ·
`0x66` stop · `0x6F` get battery · `0x6E` shutdown.

Data packets: `[tag u8][length u8][payload]`. Tag `0x01` = weight samples, payload is
repeated `float32 kg` + `uint32 µs timestamp`, little-endian. Tag `0x00` = command
response (e.g. battery mV as `uint32`).

> To verify in Phase 1 against an open-source Progressor client before relying on it.

## Phases

### Phase 1 — Firmware (`firmware/force-gauge/`)
- Arduino/PlatformIO sketch, NimBLE-Arduino + HX711 library.
- Advertises as `Progressor_DIY`, exposes the service above.
- Tare, start/stop streaming (~80 Hz, batched several samples per notification).
- Calibration factor stored in NVS; a serial command to calibrate with a known weight.
- Battery reading on an ADC pin (optional, stubbed if no divider is wired).
- **Verify:** serial output + connect with nRF Connect / Tindeq app.

### Phase 2 — App BLE layer (no UI beyond a debug screen)
- Add `react-native-ble-plx` + its Expo config plugin; iOS/Android Bluetooth permissions in `app.json`.
- `ios/` and `android/` are committed, so this needs `npx expo prebuild` (or manual native edits) and a **new dev-client build**. Not OTA-updatable.
- `services/forceGauge.ts`: scan (filter by service UUID), connect, tare, start/stop,
  battery, packet parsing, disconnect/reconnect handling.
- `contexts/ForceGaugeContext.tsx` + `useForceGauge()` hook: connection state,
  latest force, peak, sample buffer.
- Hidden debug screen: connect button, live kg readout, peak hold, tare.

### Phase 3 — Live force UI
- Reusable live chart component + big readout; % of bodyweight.

### Phase 4 — Tests & integration (separate plan)
- Max pull test, repeaters with force targets, critical force, RFD.
- Persist results; feed adaptation targets in the progression engine.

## Open questions
1. Hardware: ADC (HX711 vs other), pins, and whether a battery divider is wired.
2. Arduino IDE or PlatformIO for the firmware?
3. Where should the debug screen live (settings → "Force gauge")?
