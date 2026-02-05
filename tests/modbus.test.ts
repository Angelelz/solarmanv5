import { describe, it, expect } from "vitest";
import {
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
} from "../src/modbus.js";

describe("CRC-16/Modbus", () => {
  it("should calculate correct CRC for known data", () => {
    // Known Modbus CRC test vector: slave=1, FC=3, addr=0, qty=10
    const data = Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a]);
    const crc = crc16(data);
    // CRC is 0xCDC5 (LE bytes: C5 CD)
    expect(crc).toBe(0xcdc5);
  });

  it("getCrc should return 2-byte LE buffer", () => {
    const data = Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a]);
    const crcBuf = getCrc(data);
    expect(crcBuf.length).toBe(2);
    expect(crcBuf[0]).toBe(0xc5);
    expect(crcBuf[1]).toBe(0xcd);
  });

  it("addCrc should append CRC to data", () => {
    const data = Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a]);
    const withCrc = addCrc(data);
    expect(withCrc.length).toBe(8);
    expect(withCrc[6]).toBe(0xc5);
    expect(withCrc[7]).toBe(0xcd);
  });

  it("verifyCrc should validate correct CRC", () => {
    const frame = Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a, 0xc5, 0xcd]);
    expect(verifyCrc(frame)).toBe(true);
  });

  it("verifyCrc should reject incorrect CRC", () => {
    const frame = Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a, 0x00, 0x00]);
    expect(verifyCrc(frame)).toBe(false);
  });

  it("verifyCrc should reject frames < 4 bytes", () => {
    expect(verifyCrc(Buffer.from([0x01, 0x03]))).toBe(false);
  });
});

describe("Modbus request frame builders", () => {
  it("readHoldingRegisters builds correct frame (FC 3)", () => {
    const frame = readHoldingRegisters(1, 0x0003, 5);
    expect(frame[0]).toBe(1); // slave id
    expect(frame[1]).toBe(0x03); // function code
    expect(frame.readUInt16BE(2)).toBe(3); // start addr
    expect(frame.readUInt16BE(4)).toBe(5); // quantity
    expect(verifyCrc(frame)).toBe(true);
  });

  it("readInputRegisters builds correct frame (FC 4)", () => {
    const frame = readInputRegisters(1, 33022, 6);
    expect(frame[0]).toBe(1);
    expect(frame[1]).toBe(0x04);
    expect(frame.readUInt16BE(2)).toBe(33022);
    expect(frame.readUInt16BE(4)).toBe(6);
    expect(verifyCrc(frame)).toBe(true);
  });

  it("readCoils builds correct frame (FC 1)", () => {
    const frame = readCoils(1, 30, 1);
    expect(frame[0]).toBe(1);
    expect(frame[1]).toBe(0x01);
    expect(frame.readUInt16BE(2)).toBe(30);
    expect(frame.readUInt16BE(4)).toBe(1);
    expect(verifyCrc(frame)).toBe(true);
  });

  it("readDiscreteInputs builds correct frame (FC 2)", () => {
    const frame = readDiscreteInputs(1, 10, 8);
    expect(frame[0]).toBe(1);
    expect(frame[1]).toBe(0x02);
    expect(verifyCrc(frame)).toBe(true);
  });

  it("writeSingleRegister builds correct frame (FC 6)", () => {
    const frame = writeSingleRegister(1, 100, 0x1234);
    expect(frame[0]).toBe(1);
    expect(frame[1]).toBe(0x06);
    expect(frame.readUInt16BE(2)).toBe(100);
    expect(frame.readUInt16BE(4)).toBe(0x1234);
    expect(verifyCrc(frame)).toBe(true);
  });

  it("writeSingleCoil builds correct frame (FC 5)", () => {
    const frame = writeSingleCoil(1, 50, 0xff00);
    expect(frame[0]).toBe(1);
    expect(frame[1]).toBe(0x05);
    expect(frame.readUInt16BE(2)).toBe(50);
    expect(frame.readUInt16BE(4)).toBe(0xff00);
    expect(verifyCrc(frame)).toBe(true);
  });

  it("writeMultipleRegisters builds correct frame (FC 16)", () => {
    const frame = writeMultipleRegisters(1, 100, [0x0001, 0x0002, 0x0003]);
    expect(frame[0]).toBe(1);
    expect(frame[1]).toBe(0x10);
    expect(frame.readUInt16BE(2)).toBe(100); // start addr
    expect(frame.readUInt16BE(4)).toBe(3); // quantity
    expect(frame[6]).toBe(6); // byte count
    expect(frame.readUInt16BE(7)).toBe(1);
    expect(frame.readUInt16BE(9)).toBe(2);
    expect(frame.readUInt16BE(11)).toBe(3);
    expect(verifyCrc(frame)).toBe(true);
  });

  it("writeMultipleCoils builds correct frame (FC 15)", () => {
    const frame = writeMultipleCoils(1, 0, [1, 0, 1, 1, 0, 0, 1, 0]);
    expect(frame[0]).toBe(1);
    expect(frame[1]).toBe(0x0f);
    expect(frame.readUInt16BE(2)).toBe(0); // start addr
    expect(frame.readUInt16BE(4)).toBe(8); // quantity
    expect(frame[6]).toBe(1); // byte count
    // Bit values: 1 0 1 1 0 0 1 0 -> binary 01001101 -> 0x4D (LSB first)
    expect(frame[7]).toBe(0b01001101);
    expect(verifyCrc(frame)).toBe(true);
  });
});

describe("parseResponseAdu", () => {
  it("parses FC 3 (Read Holding Registers) response", () => {
    // Response: slave=1, FC=3, byteCount=4, data=[0x0001, 0x0002], CRC
    const request = readHoldingRegisters(1, 0, 2);
    const responsePayload = Buffer.from([0x01, 0x03, 0x04, 0x00, 0x01, 0x00, 0x02]);
    const response = addCrc(responsePayload);
    const values = parseResponseAdu(response, request);
    expect(values).toEqual([1, 2]);
  });

  it("parses FC 4 (Read Input Registers) response", () => {
    const request = readInputRegisters(1, 33022, 3);
    const responsePayload = Buffer.from([
      0x01, 0x04, 0x06, 0x00, 0x0a, 0x00, 0x14, 0x00, 0x1e,
    ]);
    const response = addCrc(responsePayload);
    const values = parseResponseAdu(response, request);
    expect(values).toEqual([10, 20, 30]);
  });

  it("parses FC 1 (Read Coils) response", () => {
    const request = readCoils(1, 0, 8);
    // Response: slave=1, FC=1, byteCount=1, data=0xAB (bits: 11010101)
    const responsePayload = Buffer.from([0x01, 0x01, 0x01, 0xab]);
    const response = addCrc(responsePayload);
    const values = parseResponseAdu(response, request);
    // 0xAB = 10101011 -> bit 0..7: 1,1,0,1,0,1,0,1
    expect(values).toEqual([1, 1, 0, 1, 0, 1, 0, 1]);
  });

  it("parses FC 6 (Write Single Register) response", () => {
    const request = writeSingleRegister(1, 100, 0x1234);
    // Echo response: same as request
    const responsePayload = Buffer.from([0x01, 0x06, 0x00, 0x64, 0x12, 0x34]);
    const response = addCrc(responsePayload);
    const values = parseResponseAdu(response, request);
    expect(values).toEqual([0x1234]);
  });

  it("throws ModbusError on exception response", () => {
    const request = readHoldingRegisters(1, 4500, 4);
    // Exception response: slave=1, FC=0x83 (0x03+0x80), exception code=2
    const responsePayload = Buffer.from([0x01, 0x83, 0x02]);
    const response = addCrc(responsePayload);
    expect(() => parseResponseAdu(response, request)).toThrow(ModbusError);
    expect(() => parseResponseAdu(response, request)).toThrow(
      "IllegalDataAddress"
    );
  });

  it("throws on CRC mismatch", () => {
    const request = readHoldingRegisters(1, 0, 2);
    const response = Buffer.from([
      0x01, 0x03, 0x04, 0x00, 0x01, 0x00, 0x02, 0xff, 0xff,
    ]);
    expect(() => parseResponseAdu(response, request)).toThrow("CRC");
  });
});
