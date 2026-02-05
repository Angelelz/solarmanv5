/**
 * Modbus RTU frame construction and parsing.
 *
 * This module replaces the Python `umodbus` dependency by implementing the
 * subset of Modbus RTU needed by SolarmanV5:
 *   - CRC-16/Modbus calculation
 *   - Request frame builders for function codes 1-6, 15, 16
 *   - Response ADU parser
 */

// ---------- CRC-16/Modbus lookup table ----------

const CRC_TABLE = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  CRC_TABLE[i] = crc;
}

/** Calculate CRC-16/Modbus over the given bytes. */
export function crc16(data: Buffer): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
  }
  return crc;
}

/** Return a 2-byte little-endian Buffer containing the CRC. */
export function getCrc(data: Buffer): Buffer {
  const c = crc16(data);
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(c, 0);
  return buf;
}

/** Append CRC-16 to the given data and return the new buffer. */
export function addCrc(data: Buffer): Buffer {
  return Buffer.concat([data, getCrc(data)]);
}

/** Verify CRC on a Modbus RTU frame. Returns true if valid. */
export function verifyCrc(frame: Buffer): boolean {
  if (frame.length < 4) return false;
  const payload = frame.subarray(0, frame.length - 2);
  const expected = frame.subarray(frame.length - 2);
  const computed = getCrc(payload);
  return computed[0] === expected[0] && computed[1] === expected[1];
}

// ---------- Modbus exception mapping ----------

export const MODBUS_EXCEPTION_NAMES: Record<number, string> = {
  1: "IllegalFunction",
  2: "IllegalDataAddress",
  3: "IllegalDataValue",
  4: "ServerDeviceFailure",
  5: "Acknowledge",
  6: "ServerDeviceBusy",
};

export class ModbusError extends Error {
  public readonly exceptionCode: number;
  constructor(exceptionCode: number) {
    const name =
      MODBUS_EXCEPTION_NAMES[exceptionCode] ??
      `UnknownException(${exceptionCode})`;
    super(`Modbus exception: ${name}`);
    this.exceptionCode = exceptionCode;
  }
}

// ---------- Request frame builders ----------

/**
 * Build a Modbus RTU request frame.
 * Adds slave address, function code, data, and CRC.
 */
function buildRequest(
  slaveId: number,
  functionCode: number,
  data: Buffer
): Buffer {
  const pdu = Buffer.alloc(2 + data.length);
  pdu[0] = slaveId;
  pdu[1] = functionCode;
  data.copy(pdu, 2);
  return addCrc(pdu);
}

/** FC 1 – Read Coils */
export function readCoils(
  slaveId: number,
  startAddr: number,
  quantity: number
): Buffer {
  const data = Buffer.alloc(4);
  data.writeUInt16BE(startAddr, 0);
  data.writeUInt16BE(quantity, 2);
  return buildRequest(slaveId, 0x01, data);
}

/** FC 2 – Read Discrete Inputs */
export function readDiscreteInputs(
  slaveId: number,
  startAddr: number,
  quantity: number
): Buffer {
  const data = Buffer.alloc(4);
  data.writeUInt16BE(startAddr, 0);
  data.writeUInt16BE(quantity, 2);
  return buildRequest(slaveId, 0x02, data);
}

/** FC 3 – Read Holding Registers */
export function readHoldingRegisters(
  slaveId: number,
  startAddr: number,
  quantity: number
): Buffer {
  const data = Buffer.alloc(4);
  data.writeUInt16BE(startAddr, 0);
  data.writeUInt16BE(quantity, 2);
  return buildRequest(slaveId, 0x03, data);
}

/** FC 4 – Read Input Registers */
export function readInputRegisters(
  slaveId: number,
  startAddr: number,
  quantity: number
): Buffer {
  const data = Buffer.alloc(4);
  data.writeUInt16BE(startAddr, 0);
  data.writeUInt16BE(quantity, 2);
  return buildRequest(slaveId, 0x04, data);
}

/** FC 5 – Write Single Coil */
export function writeSingleCoil(
  slaveId: number,
  addr: number,
  value: number
): Buffer {
  const data = Buffer.alloc(4);
  data.writeUInt16BE(addr, 0);
  data.writeUInt16BE(value, 2);
  return buildRequest(slaveId, 0x05, data);
}

/** FC 6 – Write Single Register */
export function writeSingleRegister(
  slaveId: number,
  addr: number,
  value: number
): Buffer {
  const data = Buffer.alloc(4);
  data.writeUInt16BE(addr, 0);
  data.writeUInt16BE(value, 2);
  return buildRequest(slaveId, 0x06, data);
}

/** FC 15 – Write Multiple Coils */
export function writeMultipleCoils(
  slaveId: number,
  startAddr: number,
  values: number[]
): Buffer {
  const quantity = values.length;
  const byteCount = Math.ceil(quantity / 8);
  const data = Buffer.alloc(5 + byteCount);
  data.writeUInt16BE(startAddr, 0);
  data.writeUInt16BE(quantity, 2);
  data[4] = byteCount;
  for (let i = 0; i < quantity; i++) {
    if (values[i]) {
      data[5 + Math.floor(i / 8)] |= 1 << (i % 8);
    }
  }
  return buildRequest(slaveId, 0x0f, data);
}

/** FC 16 – Write Multiple Registers */
export function writeMultipleRegisters(
  slaveId: number,
  startAddr: number,
  values: number[]
): Buffer {
  const quantity = values.length;
  const byteCount = quantity * 2;
  const data = Buffer.alloc(5 + byteCount);
  data.writeUInt16BE(startAddr, 0);
  data.writeUInt16BE(quantity, 2);
  data[4] = byteCount;
  for (let i = 0; i < quantity; i++) {
    data.writeUInt16BE(values[i], 5 + i * 2);
  }
  return buildRequest(slaveId, 0x10, data);
}

// ---------- Response ADU parsing ----------

/**
 * Parse a Modbus RTU response ADU.
 *
 * Validates CRC, checks for exception responses, and extracts register/coil
 * values based on the function code of the original request.
 *
 * @param response  The raw Modbus RTU response frame
 * @param request   The original request frame (used to determine expected FC
 *                  and quantity)
 * @returns Array of register values (16-bit) or coil/discrete input values
 */
export function parseResponseAdu(
  response: Buffer,
  request: Buffer
): number[] {
  if (response.length < 5) {
    throw new ModbusError(response.length > 2 ? response[2] : 0);
  }

  // Check for exception response (FC + 0x80)
  const requestFc = request[1];
  const responseFc = response[1];

  if (responseFc === requestFc + 0x80) {
    throw new ModbusError(response[2]);
  }

  // Verify CRC
  if (!verifyCrc(response)) {
    throw new Error("Modbus response CRC verification failed");
  }

  // Parse based on function code
  switch (responseFc) {
    case 0x01: // Read Coils
    case 0x02: {
      // Read Discrete Inputs
      const byteCount = response[2];
      const quantity = request.readUInt16BE(4);
      const values: number[] = [];
      for (let i = 0; i < quantity; i++) {
        const byteIdx = Math.floor(i / 8);
        const bitIdx = i % 8;
        values.push((response[3 + byteIdx] >> bitIdx) & 1);
      }
      return values;
    }
    case 0x03: // Read Holding Registers
    case 0x04: {
      // Read Input Registers
      const byteCount = response[2];
      const regCount = byteCount / 2;
      const values: number[] = [];
      for (let i = 0; i < regCount; i++) {
        values.push(response.readUInt16BE(3 + i * 2));
      }
      return values;
    }
    case 0x05: // Write Single Coil
    case 0x06: {
      // Write Single Register
      const value = response.readUInt16BE(4);
      return [value];
    }
    case 0x0f: // Write Multiple Coils
    case 0x10: {
      // Write Multiple Registers
      const startAddr = response.readUInt16BE(2);
      const quantity = response.readUInt16BE(4);
      return [quantity];
    }
    default:
      throw new Error(`Unsupported Modbus function code: 0x${responseFc.toString(16)}`);
  }
}
