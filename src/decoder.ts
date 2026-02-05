/**
 * Solarman V5 frame decoder utility.
 *
 * Parses and displays the contents of a V5 frame in human-readable format.
 */

import { crc16, getCrc } from "./modbus.js";

// ---------- Enums ----------

export enum V5CtrlCode {
  V5Request = 0x4510,
  V5Response = 0x1510,
  LoggerPing = 0x4710,
  LoggerResponse = 0x4210,
  Unknown = 0xdeadc0de,
}

export enum V5FrameType {
  KeepAlive = 0,
  Logger = 1,
  Inverter = 2,
  Unknown = -1,
}

const CTRL_CODE_NAMES: Record<number, string> = {
  [V5CtrlCode.V5Request]: "V5Request",
  [V5CtrlCode.V5Response]: "V5Response",
  [V5CtrlCode.LoggerPing]: "LoggerPing",
  [V5CtrlCode.LoggerResponse]: "LoggerResponse",
};

const FRAME_TYPE_NAMES: Record<number, string> = {
  [V5FrameType.KeepAlive]: "KeepAlive",
  [V5FrameType.Logger]: "Logger",
  [V5FrameType.Inverter]: "Inverter",
};

// ---------- Helper functions ----------

function unsignedInt(data: Buffer): number {
  if (data.length === 1) return data[0];
  if (data.length === 2) return data.readUInt16LE(0);
  if (data.length === 4) return data.readUInt32LE(0);
  throw new Error(`Unsupported byte length: ${data.length}`);
}

function rtuUnsignedInt(data: Buffer): number {
  if (data.length === 1) return data[0];
  if (data.length === 2) return data.readUInt16BE(0);
  if (data.length === 4) return data.readUInt32BE(0);
  throw new Error(`Unsupported byte length: ${data.length}`);
}

function toCtrlCode(value: number): V5CtrlCode {
  if (value in CTRL_CODE_NAMES) return value as V5CtrlCode;
  return V5CtrlCode.Unknown;
}

function toFrameType(value: number): V5FrameType {
  if (value in FRAME_TYPE_NAMES) return value as V5FrameType;
  return V5FrameType.Unknown;
}

// ---------- V5Frame class ----------

export class V5Frame {
  private readonly frame: Buffer;

  constructor(hexString: string) {
    this.frame = Buffer.from(hexString.replace(/\s+/g, ""), "hex");
  }

  get frameStart(): number {
    return this.frame[0];
  }

  get frameStartValid(): boolean {
    return this.frameStart === 0xa5;
  }

  get v5Checksum(): number {
    let check = 0;
    for (let i = 1; i < this.frame.length - 2; i++) {
      check = (check + this.frame[i]) & 0xff;
    }
    return check;
  }

  get v5ChecksumValid(): boolean {
    return this.frame[this.frame.length - 2] === this.v5Checksum;
  }

  get v5Length(): number {
    return unsignedInt(this.frame.subarray(1, 3));
  }

  get controlCode(): V5CtrlCode {
    return toCtrlCode(unsignedInt(this.frame.subarray(3, 5)));
  }

  get controlCodeName(): string {
    return CTRL_CODE_NAMES[this.controlCode] ?? "Unknown";
  }

  get sequenceNumbers(): [number, number] {
    return [this.frame[5], this.frame[6]];
  }

  get serial(): number {
    return unsignedInt(this.frame.subarray(7, 11));
  }

  get frameType(): V5FrameType {
    return toFrameType(this.frame[11]);
  }

  get frameTypeName(): string {
    return FRAME_TYPE_NAMES[this.frameType] ?? "Unknown";
  }

  get frameStatus(): number {
    return this.frame[12];
  }

  get totalWorkTime(): number {
    if (this.frameType === V5FrameType.KeepAlive) return 0;
    return unsignedInt(this.frame.subarray(13, 17));
  }

  get powerOnTime(): number {
    if (this.frameType === V5FrameType.KeepAlive) return 0;
    return unsignedInt(this.frame.subarray(17, 21));
  }

  get offsetTime(): number {
    if (this.frameType === V5FrameType.KeepAlive) return 0;
    return unsignedInt(this.frame.subarray(21, 25));
  }

  get rtuStartAt(): number {
    if (
      this.controlCode === V5CtrlCode.V5Request ||
      this.controlCode === V5CtrlCode.LoggerResponse
    ) {
      return 26;
    }
    return 25;
  }

  get frameCrc(): number {
    return rtuUnsignedInt(this.frame.subarray(this.frame.length - 4, this.frame.length - 2));
  }

  get calculatedCrc(): number {
    const rtuFrame = this.frame.subarray(this.rtuStartAt, this.frame.length - 4);
    const crcBuf = getCrc(rtuFrame);
    return rtuUnsignedInt(crcBuf);
  }

  get rtuCrcValid(): boolean {
    return this.frameCrc === this.calculatedCrc;
  }

  get rtuHead(): string {
    const head = this.rtuStartAt;
    return this.frame.subarray(head, head + 5).toString("hex");
  }

  get rtu(): Buffer {
    return this.frame.subarray(this.rtuStartAt, this.frame.length - 2);
  }

  get doubleCrcFrame(): boolean {
    const realCrc = this.rtu.subarray(this.rtu.length - 4, this.rtu.length - 2);
    const calculated = getCrc(this.rtu.subarray(0, this.rtu.length - 4));
    return realCrc[0] === calculated[0] && realCrc[1] === calculated[1];
  }

  payloadString(): string {
    const start = this.rtuStartAt;
    let payloadT: string;
    if (this.controlCode === V5CtrlCode.V5Request) {
      payloadT = "Request";
    } else if (this.controlCode === V5CtrlCode.V5Response) {
      payloadT = "Response";
    } else {
      payloadT = "Unknown";
    }

    const lines: string[] = [];
    lines.push(`${"=".repeat(10)} RTU Payload - [${payloadT}] ${"=".repeat(10)}`);
    lines.push(`  Slave address: ${this.frame[start]}`);
    lines.push(`  Function code: ${this.frame[start + 1]}`);
    lines.push(`  CRC: ${this.calculatedCrc.toString(16)} (valid: ${this.rtuCrcValid})`);

    if (this.doubleCrcFrame) {
      const realCrc = this.rtu.subarray(this.rtu.length - 4, this.rtu.length - 2).toString("hex");
      lines.push(`  DOUBLE CRC FRAME DETECTED - REAL CRC: ${realCrc}`);
    }

    if (this.controlCode === V5CtrlCode.V5Response) {
      const reportedSize = this.v5Length - 14;
      lines.push(`  Quantity: ${reportedSize}`);
      lines.push(`  Data: ${this.frame.subarray(start, this.frame.length - 2).toString("hex")}`);
    } else if (this.controlCode === V5CtrlCode.V5Request) {
      const addr = rtuUnsignedInt(this.frame.subarray(start + 2, start + 4));
      const qty = rtuUnsignedInt(this.frame.subarray(start + 4, start + 6));
      lines.push(`  Request Start Addr: ${addr} (${addr.toString(16).padStart(2, "0")})`);
      lines.push(`  Request Quantity: ${qty} (${qty.toString(16).padStart(2, "0")})`);
    }

    return lines.join("\n");
  }
}

/**
 * Decode a V5 frame and return a human-readable string.
 *
 * @param hexBytes  Array of hex byte strings (e.g. ["a5", "17", "00", ...])
 *                  or a single hex string
 * @returns Decoded frame description
 */
export function decode(hexBytes: string | string[]): string {
  const hexString = Array.isArray(hexBytes) ? hexBytes.join("") : hexBytes;
  const frame = new V5Frame(hexString);

  const lines: string[] = [];
  lines.push(`Frame start: ${frame.frameStart.toString(16).padStart(2, "0")} (valid: ${frame.frameStartValid})`);
  lines.push(`V5 Checksum: ${frame.v5Checksum.toString(16).padStart(2, "0")} (valid: ${frame.v5ChecksumValid})`);
  lines.push(`Length: ${frame.v5Length}`);
  lines.push(`Control Code: ${frame.controlCodeName} (hex: ${frame.controlCode.toString(16).padStart(4, "0")})`);

  const [seq1, seq2] = frame.sequenceNumbers;
  lines.push(`Sequence numbers: (${seq1}, ${seq2}) (hex: ${seq1.toString(16).padStart(2, "0")} ${seq2.toString(16).padStart(2, "0")})`);
  lines.push(`Serial Hex: ${frame.serial.toString(16)}`);
  lines.push(`Serial: ${frame.serial}`);
  lines.push(`Frame Type (${frame.frameTypeName}): ${frame.frameType}`);
  lines.push(`Frame Status: ${frame.frameStatus}`);
  lines.push(`Total Time: ${frame.totalWorkTime}`);
  lines.push(`PowerOn Time: ${frame.powerOnTime}`);
  lines.push(`Offset Time: ${frame.offsetTime}`);

  const frameTime = frame.totalWorkTime + frame.powerOnTime + frame.offsetTime;
  const dateStr = new Date(frameTime * 1000).toISOString();
  lines.push(`Frame Time: ${dateStr}`);

  if (frame.frameType !== V5FrameType.KeepAlive) {
    lines.push(`Checksum: ${frame.frameCrc} hex: ${frame.frameCrc.toString(16).padStart(4, "0")} - RTU start at: ${frame.rtuHead}`);
    lines.push(frame.payloadString());
  }

  return lines.join("\n");
}
