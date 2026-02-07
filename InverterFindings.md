# Inverter & Logger Findings

## Hardware Setup

Two identical **SunGoldPower SPH10048P 10KW 48V Split Phase Solar Inverters** (manufactured by SRNE) each connected to a Solarman V5 data logging stick:

| | Logger 1 | Logger 2 |
|---|---|---|
| **IP** | 192.168.4.247 | 192.168.4.255 |
| **Serial** | 3566545369 | 3574591882 |
| **Inverter** | SGP2508150446-301638 | SGP2509100120-100033 |
| **Firmware** | LSW5_01_2421_SS_00_00.00.00.06 | LSW5_01_2421_SS_00_00.00.00.06 |
| **WiFi** | LopezSanchez_EXT (100%) | LopezSanchez_EXT |
| **Local Modbus** | NOT WORKING | Working (slave ID 1) |
| **Cloud Push** | Working | Working |

Both loggers connect via a WiFi extender in bridge mode on the same /22 subnet (router at 192.168.4.1). Both are pingable and have accessible web admin panels at `http://<ip>/` (auth: `admin:admin`).

---

## Logger 1 Issue: Local Modbus Broken

Logger 1 accepts TCP connections on port 8899 and responds to V5 frames, but returns `frameStatus: 1` (meaning "no Modbus response from inverter") for ALL slave IDs tested (0, 1, 2, 3). The logger receives our request but the inverter never replies via the Modbus passthrough.

However, the **SolarmanSMART cloud app IS getting data** from this logger — confirmed via Excel data exports showing real-time values. The cloud push mechanism (Server A) works; only the local Modbus passthrough (port 8899) is broken.

This could be a firmware issue, a misconfiguration in the logger-to-inverter RS-485 link, or a bug in the data collection mode setting.

---

## Logger 2: Working via Modbus

Logger 2 works perfectly for local Modbus over V5. Slave ID 1 responds correctly. Slave ID 2 returns "Acknowledge" error (confirming there is no second inverter on this RS-485 bus). Each logger is connected to exactly one inverter.

---

## SolarmanSMART Excel Export Analysis

Two Excel exports were obtained from the SolarmanSMART cloud app:

- `InverterSGP2509100120-100033-Detailed Data-20260206.xlsx` (Logger 2's inverter)
- `InverterSGP2508150446-301638-Detailed Data-20260206.xlsx` (Logger 1's inverter)

### Available Columns (78 total)

The Excel exports contain columns including:
- **PV**: `DC Voltage PV1(V)`, `DC Voltage PV2(V)`, `DC Current PV1(A)`, `DC Current PV2(A)`, `DC Power PV1(W)`, `DC Power PV2(W)`, `PV Total Power(W)`
- **AC Output**: `AC Voltage R/U/A(V)`, `AC Voltage S/V/B(V)`, `AC Current R/U/A(A)`, `AC Current S/V/B(A)`
- **Battery**: SOC, voltage, current, power, charging states
- **Load**: power, voltage, current per phase
- **Grid**: voltage, frequency, power
- **Temperatures**: multiple readings
- **Cumulative**: daily generation, total generation, etc.

### Key Finding: PV1/PV2 Individual Values Are Always Zero

Even during daytime with active solar production, `DC Voltage PV1`, `DC Current PV1`, `DC Power PV1`, `DC Voltage PV2`, `DC Current PV2`, and `DC Power PV2` are **always zero** in the cloud data. Only `PV Total Power(W)` shows actual values.

This matches what we see via Modbus — the individual PV channel registers (0x0200-0x020B) are always zero. The inverter apparently does not report per-channel PV data through Modbus, only the aggregate total.

---

## Modbus Register Map (SRNE SPH10048P via Solarman V5)

### Standard SRNE Registers (0x0100-0x0109) — Function Code 3

These are the classic SRNE controller registers. Reading via `readHoldingRegisters(0x0100, 10)`:

| Register | Description | Scale | Notes |
|---|---|---|---|
| 0x0100 | Battery SOC | Low byte = % | Standard SRNE |
| 0x0101 | Battery Voltage | ×0.1 V | |
| 0x0102 | Charging Current | ×0.01 A | |
| 0x0103 | Controller Temp (high byte) / Battery Temp (low byte) | °C | |
| 0x0104 | Load DC Voltage | ×0.1 V | |
| 0x0105 | Load DC Current | ×0.01 A | |
| 0x0106 | Load DC Power | W | |
| 0x0107 | PV Voltage (standard) | ×0.1 V | **ALWAYS ZERO** on this inverter |
| 0x0108 | PV Current (standard) | ×0.01 A | **ALWAYS ZERO** |
| 0x0109 | PV Power (standard) | W | **ALWAYS ZERO** |

> **Note**: Registers 0x010A-0x0114 return `IllegalDataAddress`. Only 0x0100-0x0109 is accessible in this segment.

### Extended Registers (0x0200-0x023B) — Function Code 3

This is where the hybrid inverter's real data lives. Must be read in chunks of ~16 registers at a time (60 at once causes `UnknownException(10)`).

#### PV Section (0x0200-0x020B) — All Zero

| Register | Expected Description | Observed |
|---|---|---|
| 0x0200 | DC Voltage PV1 | 0 |
| 0x0201 | DC Current PV1 | 0 |
| 0x0202 | DC Power PV1 | 0 |
| 0x0203-0x020B | PV2 data, totals | 0 |

These are likely the PV1/PV2 individual channel registers, but this inverter never populates them — consistent with the cloud data showing zeros for these fields.

#### Inverter Status (0x020C-0x0215)

| Register | Value Example | Description |
|---|---|---|
| 0x020C | 6658 | Unknown (possibly combined status flags) |
| 0x020D | 1548 | Unknown |
| 0x020E | 10266 | Unknown |
| 0x020F-0x0211 | varies | Unknown |
| 0x0212 | varies | PV Cumulative Generation (×0.1 kWh) |
| 0x0213 | varies | Daily PV Generation (×0.1 kWh) |
| 0x0214 | varies | Unknown |
| 0x0215 | 5996 | AC Output Frequency R (×0.01 Hz → 59.96 Hz) |

#### AC Output (0x0216-0x021C)

| Register | Scale | Description |
|---|---|---|
| 0x0216 | ×0.1 V | AC Voltage R/U/A (e.g., 1206 → 120.6V) |
| 0x0217 | ×0.1 A | AC Current R |
| 0x0218 | ×0.01 Hz | AC Output Frequency S |
| 0x0219 | ×0.1 A | AC Current S |
| 0x021A | | Unknown |
| 0x021B | ×0.1 V | L1 Mains Voltage |
| 0x021C | ×0.1 V | L2 Mains Voltage |

#### Load & Power (0x0220-0x0222)

| Register | Unit | Description |
|---|---|---|
| 0x0220 | W | Load Power L1 |
| 0x0221 | W | Load Power L2 |
| 0x0222 | W | Total Consumption Power |

#### Bus & Grid (0x0228-0x0234)

| Register | Scale | Description |
|---|---|---|
| 0x0228 | ×0.1 V | PCU Bus Positive Voltage |
| 0x0229 | ×0.1 V | PCU Bus Negative Voltage |
| 0x022A | ×0.1 V | Mains Voltage Reading 1 |
| 0x022C | ×0.1 V | Mains Voltage Reading 2 |
| 0x022E | | Load rate or apparent power |
| 0x0230 | | Load rate or apparent power |
| 0x0232 | ×0.1 °F | Temperature Reading 1 |
| 0x0234 | ×0.1 °F | Temperature Reading 2 |
| 0x0236 | | Unknown (value: 23, possibly SOC or temp) |

---

## Logger Web Admin Panel

Both loggers have identical web interfaces at `http://<ip>/` with pages:
- `status.html` — Logger status, signal strength, current power readings
- `remote.html` — Remote server configuration (3 server slots)
- `select.html` — Working mode (Data collection / Transparency)
- `wireless.html` — WiFi settings
- `wirepoint.html` — Wired network settings

### Remote Server Configuration (from `remote.html`)

Each logger has three server slots:

| Server | Status | Configuration |
|---|---|---|
| **Server A** | Connected (`status_a = "1"`) | "Default" — read-only, hidden. This is the SolarmanSMART cloud connection. |
| **Server B** | Not connected (`status_b = "0"`) | Empty (`var server_b = ",,,TCP"`) — **EDITABLE, this is what we can use** |
| **Server C** | Connected | `47.91.95.200,access3.solarmanpv.com,10443,TCP` — hardcoded cloud backup |

Server B is empty and editable via the web admin. We can configure it to point to a local TCP server to receive the same data the cloud gets.

### Working Mode (`select.html`)

Options:
- **Data collection** — Logger actively reads inverter registers and pushes data to configured servers
- **Transparency** — Logger acts as transparent serial-to-TCP bridge (for direct Modbus passthrough)

---

## Strategy: Local Server via Server B

Since Logger 1's local Modbus passthrough is broken but its cloud push works, the best approach is:

1. **Build a local TCP server** that speaks the Solarman V5 server protocol
2. **Configure Server B** on both loggers to point to this local server
3. Both loggers will push data to the cloud (Server A) AND our local server (Server B) simultaneously

### V5 Server Protocol

When a logger connects to a server, it sends frames with these control codes:

| Control Code | Name | Description |
|---|---|---|
| 0x4110 | HANDSHAKE | Initial connection handshake |
| 0x4210 | DATA | Periodic data push (contains inverter register data) |
| 0x4310 | INFO | Logger firmware, IP, SSID information |
| 0x4710 | HEARTBEAT | Keep-alive packets |
| 0x4810 | REPORT | Status reports |

For each incoming frame, the server responds with a **time response frame**:

```
Header (11 bytes):
  0xA5          Start
  Length (2B)   = 10
  0x10XX        Response code = request code - 0x30
  Seq (2B)      Echo back + increment
  Serial (4B)   Logger serial

Payload (10 bytes):
  Frame type + sensor type (2B) = 0x0100
  UNIX timestamp (4B)
  TZ offset in minutes (4B)

Trailer (2 bytes):
  Checksum (1B)
  0x15          End
```

The **DATA frames (0x4210)** are the important ones — they contain the inverter's register data that the logger has collected. The existing `_v5_time_response_frame()` / `v5TimeResponseFrame()` methods in both pysolarmanv5 and our TypeScript library already know how to generate the correct response.

### Advantages Over Modbus Polling

- Gets data from **both** loggers/inverters (Logger 1's cloud push works even though local Modbus doesn't)
- The logger handles all register reading internally and sends complete data frames
- No need to figure out timing, register chunking, or slave ID issues
- Gets the full dataset the cloud receives (all 78 columns worth of data)
- Non-intrusive — Server A (cloud) continues working alongside Server B (local)

### Configuration Steps

To configure Server B on a logger, POST to `http://<ip>/do_cmd.html` with:
```
server_b=<ip>,<domain>,<port>,TCP
```
Both loggers need to be restarted after this change (via the web admin or power cycle).

---

## Next Steps

1. Build a V5 data receiver TCP server in TypeScript
2. Configure Server B on both loggers to point to the local server
3. Capture and analyze the DATA frames to understand the payload format
4. Parse the register data from DATA frames into meaningful inverter metrics
5. Integrate with the planned Next.js dashboard (see `plan.md`)
