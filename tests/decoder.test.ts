import { describe, it, expect } from "vitest";
import { V5Frame, V5CtrlCode, V5FrameType, decode } from "../src/decoder.js";

// Known V5 request frame from pysolarmanv5 docs
const KNOWN_REQUEST_HEX =
  "a5170010 45bb00 b26e3c6a 020000 00000000 00000000 00000000 01030003 000575c9 3915";

describe("V5Frame", () => {
  it("should parse a known V5 request frame", () => {
    const frame = new V5Frame(KNOWN_REQUEST_HEX);

    expect(frame.frameStart).toBe(0xa5);
    expect(frame.frameStartValid).toBe(true);
    expect(frame.v5Length).toBe(23);
    expect(frame.controlCode).toBe(V5CtrlCode.V5Request);
    expect(frame.controlCodeName).toBe("V5Request");
    expect(frame.sequenceNumbers).toEqual([0xbb, 0x00]);
    expect(frame.serial).toBe(1782345394);
    expect(frame.frameType).toBe(V5FrameType.Inverter);
    expect(frame.frameTypeName).toBe("Inverter");
    expect(frame.v5ChecksumValid).toBe(true);
  });

  it("should detect invalid start byte", () => {
    const frame = new V5Frame("ff170010450000000000000200000000000000000000000000000015");
    expect(frame.frameStartValid).toBe(false);
  });
});

describe("decode", () => {
  it("should decode a frame passed as hex string array", () => {
    const hexBytes = KNOWN_REQUEST_HEX.replace(/\s+/g, "")
      .match(/.{2}/g)!;
    const output = decode(hexBytes);

    expect(output).toContain("Frame start: a5 (valid: true)");
    expect(output).toContain("V5Request");
    expect(output).toContain("Serial: 1782345394");
    expect(output).toContain("Inverter");
    expect(output).toContain("Request Start Addr: 3");
    expect(output).toContain("Request Quantity: 5");
  });

  it("should decode a frame passed as single hex string", () => {
    const output = decode(KNOWN_REQUEST_HEX);
    expect(output).toContain("V5Request");
  });
});
