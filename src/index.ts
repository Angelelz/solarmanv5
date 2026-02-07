/**
 * solarmanv5 – A TypeScript library for interacting with Solarman (IGEN-Tech)
 * v5 based solar inverter data loggers.
 */

// Core client
export {
  SolarmanV5,
  ControlCode,
  V5FrameError,
  NoSocketAvailableError,
} from "./solarmanv5.js";

export type {
  SolarmanV5Options,
  FormatOptions,
  Logger,
} from "./solarmanv5.js";

// Modbus RTU utilities
export {
  crc16,
  getCrc,
  addCrc,
  verifyCrc,
  readCoils,
  readDiscreteInputs,
  readHoldingRegisters,
  readInputRegisters,
  writeSingleCoil,
  writeSingleRegister,
  writeMultipleCoils,
  writeMultipleRegisters,
  parseResponseAdu,
  ModbusError,
} from "./modbus.js";

// Discovery utilities
export { discover, scan } from "./discovery.js";
export type { DiscoveredLogger, DiscoverOptions } from "./discovery.js";

// Decoder utilities
export {
  V5Frame,
  V5CtrlCode,
  V5FrameType,
  decode,
} from "./decoder.js";

