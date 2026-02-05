# solarmanv5

A TypeScript library for interacting with Solarman (IGEN-Tech) v5 based solar inverter data loggers. This is a direct port of the Python [pysolarmanv5](https://github.com/jmccrohan/pysolarmanv5) library, adapted for Node.js with a JavaScript-flavored API.

It can be used as a **library** in a Node.js project or installed globally as a **CLI tool**.

## Installation

### As a project dependency

```bash
npm install solarmanv5
# or
pnpm add solarmanv5
# or
yarn add solarmanv5
```

### As a global CLI tool

```bash
npm install -g solarmanv5
# or
pnpm add -g solarmanv5
```

After installing globally, the `solarman` command will be available in your terminal.

## Requirements

- Node.js >= 18
- A Solarman V5 data logging stick connected to your solar inverter on your local network
- The IP address and serial number of the data logging stick

## Finding Your Logger

Use the `discover` command to find Solarman loggers on your local network:

```bash
solarman discover
# IP: 192.168.1.100  MAC: AA:BB:CC:DD:EE:FF  Serial: 1234567890
```

Or scan a specific broadcast address:

```bash
solarman scan 192.168.1.255
```

## CLI Usage

All commands require the logger's IP address (`-a`) and serial number (`-s`).

### Read holding registers

```bash
# Read battery voltage (register 0x0101, scale by 0.1 for volts)
solarman read-holding -a 192.168.1.100 -s 1234567890 -r 257 -q 1

# Read 10 registers starting from 0x0100 (battery SOC, voltage, current, etc.)
solarman read-holding -a 192.168.1.100 -s 1234567890 -r 256 -q 10
```

### Read input registers

```bash
solarman read-input -a 192.168.1.100 -s 1234567890 -r 33022 -q 6
```

### Write a single holding register

```bash
# Turn on load (register 0x010A = 266, value 1)
solarman write-holding -a 192.168.1.100 -s 1234567890 -r 266 -V 1
```

### Write multiple holding registers

```bash
solarman write-multiple -a 192.168.1.100 -s 1234567890 -r 100 --values 1 2 3
```

### Read coils

```bash
solarman read-coils -a 192.168.1.100 -s 1234567890 -r 0 -q 8
```

### Scan registers

Sweep a range of holding registers and display all non-zero values. Useful for discovering which registers your inverter uses:

```bash
# Scan the standard controller data range
solarman register-scan -a 192.168.1.100 -s 1234567890 --start 0x0100 --end 0x0130

# Scan with all values shown (including zeros)
solarman register-scan -a 192.168.1.100 -s 1234567890 --start 0x0100 --end 0x0130 --all

# Scan a wider range with longer delay between requests
solarman register-scan -a 192.168.1.100 -s 1234567890 --start 0x0200 --end 0x0240 --delay 2000
```

### Decode a V5 frame

Parse and inspect raw Solarman V5 protocol frames:

```bash
solarman decode a5 17 00 10 45 bb 00 b2 6e 3c 6a 02 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01 03 00 03 00 05 75 c9 39 15
```

### Common options

| Option | Description | Default |
|--------|-------------|---------|
| `-a, --address <ip>` | IP address of the data logging stick | required |
| `-s, --serial <number>` | Serial number of the data logging stick | required |
| `-p, --port <number>` | TCP port | 8899 |
| `-m, --mb-slave-id <number>` | Modbus slave ID | 1 |
| `-t, --timeout <number>` | Socket timeout in seconds | 60 |
| `-v, --verbose` | Enable verbose/debug logging | false |

## Library Usage

### Basic example

```typescript
import { SolarmanV5 } from "solarmanv5";

const modbus = new SolarmanV5("192.168.1.100", 1234567890, {
  port: 8899,
  mbSlaveId: 1,
  verbose: false,
});

await modbus.connect();

// Read battery SOC, voltage, current (registers 0x0100-0x0102)
const values = await modbus.readHoldingRegisters(0x0100, 3);
console.log("Battery SOC:", values[0] & 0xff, "%");
console.log("Battery Voltage:", values[1] * 0.1, "V");
console.log("Charging Current:", values[2] * 0.01, "A");

// Read solar panel voltage and current (registers 0x0107-0x0108)
const pv = await modbus.readHoldingRegisters(0x0107, 2);
console.log("PV Voltage:", pv[0] * 0.1, "V");
console.log("PV Current:", pv[1] * 0.01, "A");

await modbus.disconnect();
```

### Read formatted register values

```typescript
import { SolarmanV5 } from "solarmanv5";

const modbus = new SolarmanV5("192.168.1.100", 1234567890);
await modbus.connect();

// Read a single register with scaling applied
const voltage = await modbus.readHoldingRegisterFormatted(0x0101, 1, {
  scale: 0.1,
});
console.log("Battery Voltage:", voltage, "V");

// Read two registers as a signed 32-bit value
const power = await modbus.readHoldingRegisterFormatted(0x0109, 2, {
  signed: true,
});
console.log("Power:", power, "W");

// Read with bitmask and bitshift
const status = await modbus.readHoldingRegisterFormatted(0x0120, 1, {
  bitmask: 0x02,
  bitshift: 1,
});

await modbus.disconnect();
```

### Write registers

```typescript
import { SolarmanV5 } from "solarmanv5";

const modbus = new SolarmanV5("192.168.1.100", 1234567890);
await modbus.connect();

// Write a single register
await modbus.writeHoldingRegister(0x010a, 1); // Turn on load

// Write multiple registers
await modbus.writeMultipleHoldingRegisters(0xe005, [150, 144, 139]);

await modbus.disconnect();
```

### Auto-reconnect

```typescript
const modbus = new SolarmanV5("192.168.1.100", 1234567890, {
  autoReconnect: true,
});
await modbus.connect();

// If the connection drops, the client will automatically reconnect
// and retry the last request
const values = await modbus.readHoldingRegisters(0x0100, 3);
```

### Custom logger

```typescript
import { SolarmanV5, type Logger } from "solarmanv5";

const myLogger: Logger = {
  debug: (msg) => console.debug(`[DEBUG] ${msg}`),
  info: (msg) => console.info(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
};

const modbus = new SolarmanV5("192.168.1.100", 1234567890, {
  logger: myLogger,
});
```

### Discover loggers on the network

```typescript
import { discover } from "solarmanv5";

const loggers = await discover({
  address: "255.255.255.255",
  timeout: 2000,
});

for (const logger of loggers) {
  console.log(`Found: ${logger.ip} (SN: ${logger.serial}, MAC: ${logger.mac})`);
}
```

### Decode V5 frames

```typescript
import { decode, V5Frame } from "solarmanv5";

// Decode and print a human-readable frame description
const output = decode("a5170010 45bb00 b26e3c6a 0200...");
console.log(output);

// Or use the V5Frame class for programmatic access
const frame = new V5Frame("a5170010...");
console.log(frame.serial);
console.log(frame.controlCodeName);
console.log(frame.v5ChecksumValid);
```

### Send raw Modbus frames

```typescript
import { SolarmanV5, addCrc } from "solarmanv5";

const modbus = new SolarmanV5("192.168.1.100", 1234567890);
await modbus.connect();

// Build a custom Modbus RTU request frame
const request = addCrc(Buffer.from([0x01, 0x03, 0x01, 0x00, 0x00, 0x03]));

// Send raw and get raw response
const rawResponse = await modbus.sendRawModbusFrame(request);

// Or send raw and get parsed response values
const values = await modbus.sendRawModbusFrameParsed(request);

await modbus.disconnect();
```

## API Reference

### `SolarmanV5`

The main client class. All network operations are async (promise-based).

#### Constructor

```typescript
new SolarmanV5(address: string, serial: number, options?: SolarmanV5Options)
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `8899` | TCP port of the data logging stick |
| `mbSlaveId` | `number` | `1` | Modbus slave ID of the inverter |
| `socketTimeout` | `number` | `60` | Socket timeout in seconds |
| `v5ErrorCorrection` | `boolean` | `false` | Enable naive V5 frame error correction |
| `verbose` | `boolean` | `false` | Enable debug logging to console |
| `logger` | `Logger` | `null` | Custom logger instance |
| `autoReconnect` | `boolean` | `false` | Auto-reconnect on connection loss |

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `connect()` | `Promise<void>` | Connect to the data logging stick |
| `disconnect()` | `Promise<void>` | Disconnect from the data logging stick |
| `readHoldingRegisters(addr, qty)` | `Promise<number[]>` | Read holding registers (FC 3) |
| `readInputRegisters(addr, qty)` | `Promise<number[]>` | Read input registers (FC 4) |
| `readHoldingRegisterFormatted(addr, qty, opts?)` | `Promise<number>` | Read holding registers as a single formatted value |
| `readInputRegisterFormatted(addr, qty, opts?)` | `Promise<number>` | Read input registers as a single formatted value |
| `writeHoldingRegister(addr, value)` | `Promise<number>` | Write single holding register (FC 6) |
| `writeMultipleHoldingRegisters(addr, values)` | `Promise<number[]>` | Write multiple holding registers (FC 16) |
| `readCoils(addr, qty)` | `Promise<number[]>` | Read coils (FC 1) |
| `readDiscreteInputs(addr, qty)` | `Promise<number[]>` | Read discrete inputs (FC 2) |
| `writeSingleCoil(addr, value)` | `Promise<number>` | Write single coil (FC 5) |
| `writeMultipleCoils(addr, values)` | `Promise<number[]>` | Write multiple coils (FC 15) |
| `sendRawModbusFrame(frame)` | `Promise<Buffer>` | Send raw Modbus RTU frame, get raw response |
| `sendRawModbusFrameParsed(frame)` | `Promise<number[]>` | Send raw Modbus RTU frame, get parsed response |

#### Format Options

Used with `readHoldingRegisterFormatted` and `readInputRegisterFormatted`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `scale` | `number` | `1` | Multiply the result by this factor |
| `signed` | `boolean` | `false` | Interpret as signed (two's complement) |
| `bitmask` | `number` | - | Apply a bitmask to the result |
| `bitshift` | `number` | - | Right-shift the result |

## Differences from pysolarmanv5

This is a TypeScript port of the Python library with the following adaptations:

- **Single async class** instead of separate sync and async classes. Node.js networking is inherently async, so there is one `SolarmanV5` class that uses promises.
- **camelCase API** following JavaScript conventions (`readHoldingRegisters` instead of `read_holding_registers`).
- **No external Modbus dependency.** The Python library depends on `umodbus`. This library includes a built-in Modbus RTU implementation with CRC-16, frame builders for all standard function codes, and response parsing.
- **Constructor options object** instead of positional arguments. Pass `{ port, mbSlaveId, verbose }` as the third argument.

## Credits

This library is a port of [pysolarmanv5](https://github.com/jmccrohan/pysolarmanv5) by Jonathan McCrohan. All protocol logic, frame encoding/decoding, and Modbus handling are derived from that project.

## License

MIT
