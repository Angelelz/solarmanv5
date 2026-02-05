/**
 * SolarmanV5 – TypeScript port of pysolarmanv5
 *
 * Establishes a TCP connection to a Solarman V5 data logging stick and
 * exposes methods to send/receive Modbus RTU requests and responses.
 *
 * Node.js networking is inherently async, so this class is fully
 * promise-based (no separate sync/async split like the Python version).
 */

import net from "node:net";
import { EventEmitter } from "node:events";
import * as modbus from "./modbus.js";

// ---------- Constants ----------

export const ControlCode = {
  HANDSHAKE: 0x41,
  DATA: 0x42,
  INFO: 0x43,
  REQUEST: 0x45,
  HEARTBEAT: 0x47,
  REPORT: 0x48,
} as const;

type ControlCodeValue = (typeof ControlCode)[keyof typeof ControlCode];

const CONTROL_CODE_VALUES = new Set<number>(Object.values(ControlCode));

const V5_START = 0xa5;
const V5_END = 0x15;

// ---------- Errors ----------

export class V5FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "V5FrameError";
  }
}

export class NoSocketAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoSocketAvailableError";
  }
}

// ---------- Logger interface ----------

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const nullLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function createConsoleLogger(): Logger {
  return {
    debug: (...args: unknown[]) => console.debug("[solarmanv5]", ...args),
    info: (...args: unknown[]) => console.info("[solarmanv5]", ...args),
    warn: (...args: unknown[]) => console.warn("[solarmanv5]", ...args),
    error: (...args: unknown[]) => console.error("[solarmanv5]", ...args),
  };
}

// ---------- Options ----------

export interface SolarmanV5Options {
  /** TCP port to connect to data logging stick. Default: 8899 */
  port?: number;
  /** Inverter Modbus slave ID. Default: 1 */
  mbSlaveId?: number;
  /** Socket timeout in seconds. Default: 60 */
  socketTimeout?: number;
  /** Enable naive error correction for V5 frames. Default: false */
  v5ErrorCorrection?: boolean;
  /** Enable verbose/debug logging. Default: false */
  verbose?: boolean;
  /** Custom logger instance */
  logger?: Logger;
  /** Enable auto-reconnect on connection loss. Default: false */
  autoReconnect?: boolean;
}

// ---------- Format options ----------

export interface FormatOptions {
  /** Scaling factor. Default: 1 */
  scale?: number;
  /** Interpret as signed (2s complement). Default: false */
  signed?: boolean;
  /** Bitmask to apply */
  bitmask?: number;
  /** Right-shift amount */
  bitshift?: number;
}

// ---------- Main class ----------

export class SolarmanV5 extends EventEmitter {
  public readonly address: string;
  public readonly serial: number;
  public readonly port: number;
  public readonly mbSlaveId: number;
  public readonly socketTimeout: number;
  public readonly v5ErrorCorrection: boolean;
  public readonly autoReconnect: boolean;

  private log: Logger;
  private sequenceNumber: number | null = null;
  private socket: net.Socket | null = null;
  private connected = false;
  private lastFrame: Buffer = Buffer.alloc(0);

  // Deferred promise for waiting on data
  private dataResolve: ((data: Buffer) => void) | null = null;
  private dataReject: ((err: Error) => void) | null = null;
  private dataWanted = false;

  // V5 frame constant parts
  private readonly v5Serial: Buffer;
  private readonly v5FrameType = Buffer.from([0x02]);
  private readonly v5SensorType = Buffer.from([0x00, 0x00]);
  private readonly v5DeliveryTime = Buffer.from([0x00, 0x00, 0x00, 0x00]);
  private readonly v5PowerOnTime = Buffer.from([0x00, 0x00, 0x00, 0x00]);
  private readonly v5OffsetTime = Buffer.from([0x00, 0x00, 0x00, 0x00]);

  constructor(address: string, serial: number, options: SolarmanV5Options = {}) {
    super();

    this.address = address;
    this.serial = serial;
    this.port = options.port ?? 8899;
    this.mbSlaveId = options.mbSlaveId ?? 1;
    this.socketTimeout = options.socketTimeout ?? 60;
    this.v5ErrorCorrection = options.v5ErrorCorrection ?? false;
    this.autoReconnect = options.autoReconnect ?? false;

    if (options.logger) {
      this.log = options.logger;
    } else if (options.verbose) {
      this.log = createConsoleLogger();
    } else {
      this.log = nullLogger;
    }

    // Encode serial as 4-byte little-endian
    this.v5Serial = Buffer.alloc(4);
    this.v5Serial.writeUInt32LE(this.serial, 0);
  }

  // ---------- V5 protocol helpers ----------

  /** Get response control code from request control code */
  private static getResponseCode(code: number): number {
    return code - 0x30;
  }

  /** Calculate checksum on all bytes (sum & 0xFF) */
  private static calculateChecksum(data: Buffer): number {
    let checksum = 0;
    for (let i = 0; i < data.length; i++) {
      checksum = (checksum + (data[i] & 0xff)) & 0xff;
    }
    return checksum;
  }

  /** Calculate checksum on all frame bytes except start, end and checksum */
  static calculateV5FrameChecksum(frame: Buffer): number {
    return SolarmanV5.calculateChecksum(frame.subarray(1, frame.length - 2));
  }

  /** Get the next sequence number for use in outgoing packets */
  private getNextSequenceNumber(): number {
    if (this.sequenceNumber === null) {
      this.sequenceNumber = Math.floor(Math.random() * 254) + 1;
    } else {
      this.sequenceNumber = (this.sequenceNumber + 1) & 0xff;
    }
    return this.sequenceNumber;
  }

  /** Construct V5 header */
  private v5Header(length: number, control: number, seq: Buffer): Buffer {
    const header = Buffer.alloc(11);
    header[0] = V5_START;
    header.writeUInt16LE(length, 1);
    header[3] = 0x10; // control code suffix
    header[4] = control;
    seq.copy(header, 5, 0, 2);
    this.v5Serial.copy(header, 7);
    return header;
  }

  /** Construct V5 trailer (checksum + end byte) */
  private v5Trailer(data: Buffer): Buffer {
    const trailer = Buffer.alloc(2);
    trailer[0] = SolarmanV5.calculateChecksum(data.subarray(1));
    trailer[1] = V5_END;
    return trailer;
  }

  /** Encode a Modbus RTU frame inside a V5 data logging stick frame */
  private v5FrameEncoder(modbusFrame: Buffer): Buffer {
    const length = 15 + modbusFrame.length;
    const seqNum = this.getNextSequenceNumber();
    const seq = Buffer.alloc(2);
    seq.writeUInt16LE(seqNum, 0);

    const header = this.v5Header(length, ControlCode.REQUEST, seq);
    const payload = Buffer.concat([
      this.v5FrameType,
      this.v5SensorType,
      this.v5DeliveryTime,
      this.v5PowerOnTime,
      this.v5OffsetTime,
      modbusFrame,
    ]);

    const frame = Buffer.concat([header, payload]);
    return Buffer.concat([frame, this.v5Trailer(frame)]);
  }

  /** Decode a V5 data logging stick frame and return the Modbus RTU frame */
  private v5FrameDecoder(v5Frame: Buffer): Buffer {
    const frameLen = v5Frame.length;
    const payloadLen = v5Frame.readUInt16LE(1);
    const frameLenWithoutPayloadLen = 13;

    let effectiveLen = frameLen;
    if (frameLen !== frameLenWithoutPayloadLen + payloadLen) {
      this.log.debug("frame_len does not match payload_len.");
      if (this.v5ErrorCorrection) {
        effectiveLen = frameLenWithoutPayloadLen + payloadLen;
      }
    }

    if (v5Frame[0] !== V5_START || v5Frame[v5Frame.length - 1] !== V5_END) {
      throw new V5FrameError("V5 frame contains invalid start or end values");
    }
    if (v5Frame[v5Frame.length - 2] !== SolarmanV5.calculateV5FrameChecksum(v5Frame)) {
      throw new V5FrameError("V5 frame contains invalid V5 checksum");
    }
    if (v5Frame[5] !== this.sequenceNumber) {
      throw new V5FrameError("V5 frame contains invalid sequence number");
    }
    if (
      v5Frame[7] !== this.v5Serial[0] ||
      v5Frame[8] !== this.v5Serial[1] ||
      v5Frame[9] !== this.v5Serial[2] ||
      v5Frame[10] !== this.v5Serial[3]
    ) {
      throw new V5FrameError(
        "V5 frame contains incorrect data logger serial number"
      );
    }
    if (v5Frame[4] !== SolarmanV5.getResponseCode(ControlCode.REQUEST)) {
      throw new V5FrameError("V5 frame contains incorrect control code");
    }
    if (v5Frame[11] !== 0x02) {
      throw new V5FrameError("V5 frame contains invalid frametype");
    }

    const modbusFrame = v5Frame.subarray(25, v5Frame.length - 2);

    if (modbusFrame.length < 5) {
      if (modbusFrame.length > 0) {
        const exName =
          modbus.MODBUS_EXCEPTION_NAMES[modbusFrame[0]];
        if (exName) {
          throw new V5FrameError(`V5 Modbus EXCEPTION: ${exName}`);
        }
      }
      throw new V5FrameError(
        "V5 frame does not contain a valid Modbus RTU frame"
      );
    }

    return modbusFrame;
  }

  /** Create time response frame for keepalive/handshake/heartbeat etc. */
  private v5TimeResponseFrame(frame: Buffer): Buffer {
    const responseCode = SolarmanV5.getResponseCode(frame[4]);
    const seq = frame.subarray(5, 7);
    const header = this.v5Header(10, responseCode, seq);

    const payload = Buffer.alloc(10);
    payload.writeUInt16LE(0x0100, 0); // frame & sensor type
    payload.writeUInt32LE(Math.floor(Date.now() / 1000), 2); // unix timestamp
    payload.writeUInt32LE(0, 6); // offset

    const responseFrame = Buffer.concat([header, payload]);
    // Increment seq byte
    responseFrame[5] = (responseFrame[5] + 1) & 0xff;

    return Buffer.concat([responseFrame, this.v5Trailer(responseFrame)]);
  }

  /** Validate received frame */
  private receivedFrameIsValid(frame: Buffer): boolean {
    if (frame[0] !== V5_START) {
      this.log.debug(
        `[${this.serial}] V5_MISMATCH: ${frame.toString("hex")}`
      );
      return false;
    }
    if (frame[5] !== this.sequenceNumber) {
      this.log.debug(
        `[${this.serial}] V5_SEQ_NO_MISMATCH: ${frame.toString("hex")}`
      );
      return false;
    }
    return true;
  }

  /**
   * Check if frame has a known control code that requires a time response.
   * Returns [shouldContinue, responseFrame].
   */
  private receivedFrameResponse(
    frame: Buffer
  ): [boolean, Buffer | null] {
    if (
      frame[4] !== ControlCode.REQUEST &&
      CONTROL_CODE_VALUES.has(frame[4])
    ) {
      const controlName =
        Object.entries(ControlCode).find(([, v]) => v === frame[4])?.[0] ??
        "UNKNOWN";
      this.log.debug(
        `[${this.serial}] V5_${controlName}: ${frame.toString("hex")}`
      );
      const responseFrame = this.v5TimeResponseFrame(frame);
      this.log.debug(
        `[${this.serial}] V5_${controlName} RESP: ${responseFrame.toString("hex")}`
      );
      return [false, responseFrame];
    }
    return [true, null];
  }

  /** Handle protocol frames, send response if needed */
  private handleProtocolFrame(frame: Buffer): boolean {
    const [doContinue, responseFrame] = this.receivedFrameResponse(frame);
    if (responseFrame !== null && this.socket && !this.socket.destroyed) {
      this.socket.write(responseFrame);
    }
    return doContinue;
  }

  /**
   * Strip extra zeroes in case the frame has double CRC applied.
   * See https://github.com/jmccrohan/pysolarmanv5/issues/62
   */
  private handleDoubleCrc(frame: Buffer): Buffer {
    const zeroes = Buffer.from([0x00, 0x00]);
    if (frame.length < 4) return frame;
    if (
      frame[frame.length - 1] !== 0x00 ||
      frame[frame.length - 2] !== 0x00
    ) {
      return frame;
    }
    const stripped = frame.subarray(0, frame.length - 2);
    const strippedPayload = stripped.subarray(0, stripped.length - 2);
    const strippedCrc = stripped.subarray(stripped.length - 2);
    const computedCrc = modbus.getCrc(strippedPayload);
    if (computedCrc[0] === strippedCrc[0] && computedCrc[1] === strippedCrc[1]) {
      return stripped;
    }
    return frame;
  }

  // ---------- Connection management ----------

  /** Connect to the data logging stick */
  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      socket.setTimeout(this.socketTimeout * 1000);

      const onError = (err: Error) => {
        cleanup();
        reject(new NoSocketAvailableError(`Cannot open connection to ${this.address}: ${err.message}`));
      };

      const onConnect = () => {
        cleanup();
        this.socket = socket;
        this.connected = true;
        this.setupSocketListeners();
        this.log.debug(`Connected to ${this.address}:${this.port}`);
        resolve();
      };

      const cleanup = () => {
        socket.removeListener("error", onError);
        socket.removeListener("connect", onConnect);
      };

      socket.once("error", onError);
      socket.once("connect", onConnect);
      socket.connect(this.port, this.address);
    });
  }

  /** Set up event listeners on the connected socket */
  private setupSocketListeners(): void {
    if (!this.socket) return;

    this.socket.on("data", (data: Buffer) => {
      this.log.debug(`[${this.serial}] RAW RECD: ${data.toString("hex")}`);

      if (!this.receivedFrameIsValid(data)) {
        return;
      }

      if (!this.handleProtocolFrame(data)) {
        return;
      }

      if (this.dataWanted && this.dataResolve) {
        this.dataWanted = false;
        this.dataResolve(data);
        this.dataResolve = null;
        this.dataReject = null;
      } else {
        this.log.debug(
          `[DISCARDED] RECD: ${data.toString("hex")}`
        );
      }
    });

    this.socket.on("close", () => {
      this.log.debug("Socket closed");
      this.connected = false;

      if (this.dataWanted && this.dataReject) {
        if (this.autoReconnect) {
          // Try to reconnect and resend
          this.reconnect()
            .then(() => {
              if (this.socket && this.lastFrame.length > 0) {
                this.log.debug("Data expected. Retrying last request after reconnect.");
                this.socket.write(this.lastFrame);
              }
            })
            .catch((err) => {
              if (this.dataReject) {
                this.dataReject(
                  new NoSocketAvailableError("Connection closed on read")
                );
                this.dataResolve = null;
                this.dataReject = null;
              }
            });
        } else {
          this.dataReject(
            new NoSocketAvailableError("Connection closed on read")
          );
          this.dataResolve = null;
          this.dataReject = null;
        }
      } else if (this.autoReconnect) {
        this.reconnect().catch((err) => {
          this.log.debug(`Auto-reconnect failed: ${err.message}`);
        });
      }
    });

    this.socket.on("error", (err: Error) => {
      this.log.debug(`Socket error: ${err.message}`);
      if (this.dataWanted && this.dataReject) {
        this.dataReject(err);
        this.dataResolve = null;
        this.dataReject = null;
        this.dataWanted = false;
      }
    });

    this.socket.on("timeout", () => {
      this.log.debug("Socket timeout");
      this.socket?.destroy();
    });
  }

  /** Reconnect to the data logging stick */
  async reconnect(): Promise<void> {
    this.log.debug("Attempting reconnect...");
    try {
      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.destroy();
        this.socket = null;
      }
    } catch {
      // ignore cleanup errors
    }

    try {
      await this.connect();
      this.log.debug("Reconnect successful");
    } catch (err) {
      this.log.debug(`Reconnect failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /** Disconnect from the data logging stick */
  async disconnect(): Promise<void> {
    this.dataWanted = false;
    return new Promise<void>((resolve) => {
      if (!this.socket) {
        resolve();
        return;
      }

      this.socket.removeAllListeners();

      const onClose = () => {
        this.socket = null;
        this.connected = false;
        resolve();
      };

      this.socket.once("close", onClose);

      try {
        this.socket.end();
        // If end doesn't trigger close fast enough, force destroy
        setTimeout(() => {
          if (this.socket) {
            this.socket.destroy();
            this.socket = null;
            this.connected = false;
          }
          resolve();
        }, 500);
      } catch {
        this.socket = null;
        this.connected = false;
        resolve();
      }
    });
  }

  // ---------- Frame send/receive ----------

  /** Send frame to the data logger and receive response */
  private async sendReceiveFrame(frame: Buffer): Promise<Buffer> {
    this.log.debug(`[${this.serial}] SENT: ${frame.toString("hex")}`);

    if (!this.socket || this.socket.destroyed) {
      throw new NoSocketAvailableError("Connection already closed.");
    }

    this.lastFrame = frame;
    this.dataWanted = true;

    return new Promise<Buffer>((resolve, reject) => {
      this.dataResolve = resolve;
      this.dataReject = reject;

      const timeout = setTimeout(() => {
        this.dataWanted = false;
        this.dataResolve = null;
        this.dataReject = null;
        reject(new Error("Timeout waiting for response"));
      }, this.socketTimeout * 1000);

      // Wrap resolve/reject to clear timeout
      const origResolve = this.dataResolve;
      const origReject = this.dataReject;

      this.dataResolve = (data: Buffer) => {
        clearTimeout(timeout);
        origResolve(data);
      };
      this.dataReject = (err: Error) => {
        clearTimeout(timeout);
        origReject(err);
      };

      this.socket!.write(frame);
    });
  }

  /** Encode, send, receive, and decode a Modbus RTU frame */
  private async sendReceiveModbusFrame(
    mbRequestFrame: Buffer
  ): Promise<Buffer> {
    const v5RequestFrame = this.v5FrameEncoder(mbRequestFrame);
    const v5ResponseFrame = await this.sendReceiveFrame(v5RequestFrame);
    return this.v5FrameDecoder(v5ResponseFrame);
  }

  /** Send Modbus request frame and return parsed response values */
  private async getModbusResponse(
    mbRequestFrame: Buffer
  ): Promise<number[]> {
    const mbResponseFrame = await this.sendReceiveModbusFrame(mbRequestFrame);
    try {
      return modbus.parseResponseAdu(mbResponseFrame, mbRequestFrame);
    } catch (e) {
      if (e instanceof Error && e.message.includes("CRC")) {
        // Try handling double CRC
        const corrected = this.handleDoubleCrc(mbResponseFrame);
        if (corrected.length !== mbResponseFrame.length) {
          return modbus.parseResponseAdu(corrected, mbRequestFrame);
        }
      }
      throw e;
    }
  }

  // ---------- Static helpers ----------

  /** Calculate 2s complement */
  static twosComplement(val: number, numBits: number): number {
    if (val < 0) {
      val = (1 << numBits) + val;
    } else {
      if (val & (1 << (numBits - 1))) {
        val = val - (1 << numBits);
      }
    }
    return val;
  }

  /** Format a list of modbus register values as a single value */
  private formatResponse(
    modbusValues: number[],
    options: FormatOptions = {}
  ): number {
    const { scale = 1, signed = false, bitmask, bitshift } = options;

    let response = 0;
    const numRegisters = modbusValues.length;

    for (let i = 0; i < numRegisters; i++) {
      const j = numRegisters - 1 - i;
      response += modbusValues[i] * Math.pow(2, j * 16);
    }

    if (signed) {
      response = SolarmanV5.twosComplement(response, numRegisters * 16);
    }
    if (scale !== 1) {
      response *= scale;
    }
    if (bitmask !== undefined) {
      response &= bitmask;
    }
    if (bitshift !== undefined) {
      response >>= bitshift;
    }

    return response;
  }

  // ---------- Public Modbus API ----------

  /**
   * Read input registers from modbus slave (Modbus function code 4)
   *
   * @param registerAddr  Modbus register start address
   * @param quantity      Number of registers to query
   * @returns Array of register values
   */
  async readInputRegisters(
    registerAddr: number,
    quantity: number
  ): Promise<number[]> {
    const frame = modbus.readInputRegisters(
      this.mbSlaveId,
      registerAddr,
      quantity
    );
    return this.getModbusResponse(frame);
  }

  /**
   * Read holding registers from modbus slave (Modbus function code 3)
   *
   * @param registerAddr  Modbus register start address
   * @param quantity      Number of registers to query
   * @returns Array of register values
   */
  async readHoldingRegisters(
    registerAddr: number,
    quantity: number
  ): Promise<number[]> {
    const frame = modbus.readHoldingRegisters(
      this.mbSlaveId,
      registerAddr,
      quantity
    );
    return this.getModbusResponse(frame);
  }

  /**
   * Read input registers and format as a single value (Modbus function code 4)
   */
  async readInputRegisterFormatted(
    registerAddr: number,
    quantity: number,
    options?: FormatOptions
  ): Promise<number> {
    const values = await this.readInputRegisters(registerAddr, quantity);
    return this.formatResponse(values, options);
  }

  /**
   * Read holding registers and format as a single value (Modbus function code 3)
   */
  async readHoldingRegisterFormatted(
    registerAddr: number,
    quantity: number,
    options?: FormatOptions
  ): Promise<number> {
    const values = await this.readHoldingRegisters(registerAddr, quantity);
    return this.formatResponse(values, options);
  }

  /**
   * Write a single holding register (Modbus function code 6)
   *
   * @param registerAddr  Modbus register address
   * @param value         Value to write
   * @returns Value written
   */
  async writeHoldingRegister(
    registerAddr: number,
    value: number
  ): Promise<number> {
    const frame = modbus.writeSingleRegister(
      this.mbSlaveId,
      registerAddr,
      value
    );
    const result = await this.getModbusResponse(frame);
    return result[0];
  }

  /**
   * Write multiple holding registers (Modbus function code 16)
   *
   * @param registerAddr  Modbus register start address
   * @param values        Values to write
   * @returns Number of registers written
   */
  async writeMultipleHoldingRegisters(
    registerAddr: number,
    values: number[]
  ): Promise<number[]> {
    const frame = modbus.writeMultipleRegisters(
      this.mbSlaveId,
      registerAddr,
      values
    );
    return this.getModbusResponse(frame);
  }

  /**
   * Read coils from modbus slave (Modbus function code 1)
   *
   * @param registerAddr  Modbus register start address
   * @param quantity      Number of coils to query
   * @returns Array of coil values (0 or 1)
   */
  async readCoils(
    registerAddr: number,
    quantity: number
  ): Promise<number[]> {
    const frame = modbus.readCoils(this.mbSlaveId, registerAddr, quantity);
    return this.getModbusResponse(frame);
  }

  /**
   * Read discrete inputs from modbus slave (Modbus function code 2)
   *
   * @param registerAddr  Modbus register start address
   * @param quantity      Number of inputs to query
   * @returns Array of input values (0 or 1)
   */
  async readDiscreteInputs(
    registerAddr: number,
    quantity: number
  ): Promise<number[]> {
    const frame = modbus.readDiscreteInputs(
      this.mbSlaveId,
      registerAddr,
      quantity
    );
    return this.getModbusResponse(frame);
  }

  /**
   * Write single coil (Modbus function code 5)
   *
   * @param registerAddr  Modbus register address
   * @param value         0xFF00 (On) or 0x0000 (Off)
   * @returns Value written
   */
  async writeSingleCoil(
    registerAddr: number,
    value: number
  ): Promise<number> {
    const frame = modbus.writeSingleCoil(
      this.mbSlaveId,
      registerAddr,
      value
    );
    const result = await this.getModbusResponse(frame);
    return result[0];
  }

  /**
   * Write multiple coils (Modbus function code 15)
   *
   * @param registerAddr  Modbus register start address
   * @param values        Values to write (1 = On, 0 = Off)
   * @returns Number of coils written
   */
  async writeMultipleCoils(
    registerAddr: number,
    values: number[]
  ): Promise<number[]> {
    const frame = modbus.writeMultipleCoils(
      this.mbSlaveId,
      registerAddr,
      values
    );
    return this.getModbusResponse(frame);
  }

  /**
   * Mask write a single holding register (Modbus function code 22).
   *
   * This is a software implementation using read + write. It is NOT atomic.
   *
   * @param registerAddr  Modbus register address
   * @param orMask        OR mask (set bits). Default: 0x0000
   * @param andMask       AND mask (clear bits). Default: 0xFFFF
   * @returns Value written (or current value if no-op)
   */
  async maskedWriteHoldingRegister(
    registerAddr: number,
    orMask = 0x0000,
    andMask = 0xffff
  ): Promise<number> {
    const currentValues = await this.readHoldingRegisters(registerAddr, 1);
    const currentValue = currentValues[0];

    if (orMask !== 0x0000 || andMask !== 0xffff) {
      let maskedValue = currentValue;
      maskedValue |= orMask;
      maskedValue &= andMask;
      return this.writeHoldingRegister(registerAddr, maskedValue);
    }
    return currentValue;
  }

  /**
   * Send a raw Modbus RTU frame and return the raw response frame
   */
  async sendRawModbusFrame(mbRequestFrame: Buffer): Promise<Buffer> {
    return this.sendReceiveModbusFrame(mbRequestFrame);
  }

  /**
   * Send a raw Modbus RTU frame and return parsed response values
   */
  async sendRawModbusFrameParsed(
    mbRequestFrame: Buffer
  ): Promise<number[]> {
    return this.getModbusResponse(mbRequestFrame);
  }
}
