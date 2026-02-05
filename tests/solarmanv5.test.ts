import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net from "node:net";
import {
  SolarmanV5,
  ControlCode,
  V5FrameError,
  NoSocketAvailableError,
} from "../src/solarmanv5.js";
import { addCrc } from "../src/modbus.js";

const TEST_SERIAL = 2612749371;
const TEST_PORT = 18899;

/**
 * Mock Solarman V5 data logger server.
 *
 * Receives V5 frames, extracts the Modbus RTU request, generates a fake
 * response, wraps it back in a V5 response frame, and sends it back.
 */
function createMockServer(): net.Server {
  const server = net.createServer((socket) => {
    socket.on("data", (raw) => {
      try {
        const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        // Validate V5 start byte
        if (data[0] !== 0xa5) {
          return;
        }

        const controlCode = data[4];

        // If it's a non-REQUEST control code (like heartbeat response), ignore
        if (controlCode !== ControlCode.REQUEST) {
          return;
        }

        // Extract sequence number and serial from request
        const seqByte = data[5];
        const serialBytes = data.subarray(7, 11);

        // Extract Modbus RTU frame (starts at offset 25 for request payloads
        // which have 15 bytes of V5 payload before modbus frame. Header is 11 bytes.)
        // V5 header: 11 bytes
        // V5 payload before modbus: frametype(1) + sensortype(2) + deliverytime(4) + powerontime(4) + offsettime(4) = 15 bytes
        // So modbus starts at 11 + 15 = 26
        const modbusFrame = data.subarray(26, data.length - 2);

        if (modbusFrame.length < 4) {
          return;
        }

        const slaveId = modbusFrame[0];
        const functionCode = modbusFrame[1];

        let modbusResponse: Buffer;

        // Check if register address is > 4000 to simulate exception
        if (modbusFrame.length >= 4) {
          const startAddr = modbusFrame.readUInt16BE(2);
          if (startAddr > 4000) {
            // Return Modbus exception
            modbusResponse = addCrc(
              Buffer.from([slaveId, functionCode + 0x80, 0x02])
            );
          } else {
            // Generate response based on function code
            modbusResponse = generateModbusResponse(
              slaveId,
              functionCode,
              modbusFrame
            );
          }
        } else {
          modbusResponse = addCrc(
            Buffer.from([slaveId, functionCode + 0x80, 0x01])
          );
        }

        // Build V5 response frame
        const responsePayloadLen = 14 + modbusResponse.length;
        const v5Response = Buffer.alloc(13 + responsePayloadLen);

        // Header
        v5Response[0] = 0xa5; // start
        v5Response.writeUInt16LE(responsePayloadLen, 1); // length
        v5Response[3] = 0x10; // control code suffix
        v5Response[4] = controlCode - 0x30; // response code (0x45 -> 0x15)
        v5Response[5] = seqByte; // echo seq number
        v5Response[6] = (seqByte + 1) & 0xff; // server seq
        serialBytes.copy(v5Response, 7); // serial

        // Payload
        v5Response[11] = 0x02; // frame type (inverter)
        v5Response[12] = 0x01; // status
        v5Response.writeUInt32LE(1000, 13); // total work time
        v5Response.writeUInt32LE(500, 17); // power on time
        v5Response.writeUInt32LE(
          Math.floor(Date.now() / 1000) - 1000,
          21
        ); // offset time
        modbusResponse.copy(v5Response, 25);

        // Trailer
        let checksum = 0;
        for (let i = 1; i < v5Response.length - 2; i++) {
          checksum = (checksum + v5Response[i]) & 0xff;
        }
        v5Response[v5Response.length - 2] = checksum;
        v5Response[v5Response.length - 1] = 0x15; // end

        socket.write(v5Response);
      } catch {
        // Ignore errors in mock server
      }
    });
  });

  return server;
}

function generateModbusResponse(
  slaveId: number,
  functionCode: number,
  request: Buffer
): Buffer {
  const quantity =
    request.length >= 6 ? request.readUInt16BE(4) : 1;

  switch (functionCode) {
    case 0x01: // Read Coils
    case 0x02: {
      // Read Discrete Inputs
      const byteCount = Math.ceil(quantity / 8);
      const payload = Buffer.alloc(3 + byteCount);
      payload[0] = slaveId;
      payload[1] = functionCode;
      payload[2] = byteCount;
      for (let i = 0; i < byteCount; i++) {
        payload[3 + i] = 0xab; // some test coil values
      }
      return addCrc(payload);
    }
    case 0x03: // Read Holding Registers
    case 0x04: {
      // Read Input Registers
      const byteCount = quantity * 2;
      const payload = Buffer.alloc(3 + byteCount);
      payload[0] = slaveId;
      payload[1] = functionCode;
      payload[2] = byteCount;
      for (let i = 0; i < quantity; i++) {
        payload.writeUInt16BE(100 + i, 3 + i * 2);
      }
      return addCrc(payload);
    }
    case 0x05: // Write Single Coil
    case 0x06: {
      // Write Single Register - echo request
      return addCrc(request.subarray(0, 6));
    }
    case 0x0f: // Write Multiple Coils
    case 0x10: {
      // Write Multiple Registers
      const payload = Buffer.alloc(6);
      payload[0] = slaveId;
      payload[1] = functionCode;
      request.copy(payload, 2, 2, 6); // echo start addr + quantity
      return addCrc(payload);
    }
    default:
      return addCrc(Buffer.from([slaveId, functionCode + 0x80, 0x01]));
  }
}

describe("SolarmanV5", () => {
  let server: net.Server;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        server = createMockServer();
        server.listen(TEST_PORT, "127.0.0.1", () => resolve());
      })
  );

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      })
  );

  it("should connect and disconnect", async () => {
    const modbus = new SolarmanV5("127.0.0.1", TEST_SERIAL, {
      port: TEST_PORT,
      socketTimeout: 5,
    });
    await modbus.connect();
    await modbus.disconnect();
  });

  it("should throw NoSocketAvailableError on bad address", async () => {
    // Use a port that nothing is listening on (TEST_PORT + 1)
    const modbus = new SolarmanV5("127.0.0.1", TEST_SERIAL, {
      port: TEST_PORT + 1,
      socketTimeout: 1,
    });
    await expect(modbus.connect()).rejects.toThrow(NoSocketAvailableError);
  });

  it("should read holding registers", async () => {
    const modbus = new SolarmanV5("127.0.0.1", TEST_SERIAL, {
      port: TEST_PORT,
      socketTimeout: 5,
    });
    await modbus.connect();
    try {
      const result = await modbus.readHoldingRegisters(20, 4);
      expect(result).toHaveLength(4);
      expect(result).toEqual([100, 101, 102, 103]);
    } finally {
      await modbus.disconnect();
    }
  });

  it("should read input registers", async () => {
    const modbus = new SolarmanV5("127.0.0.1", TEST_SERIAL, {
      port: TEST_PORT,
      socketTimeout: 5,
    });
    await modbus.connect();
    try {
      const result = await modbus.readInputRegisters(40, 6);
      expect(result).toHaveLength(6);
    } finally {
      await modbus.disconnect();
    }
  });

  it("should read coils", async () => {
    const modbus = new SolarmanV5("127.0.0.1", TEST_SERIAL, {
      port: TEST_PORT,
      socketTimeout: 5,
    });
    await modbus.connect();
    try {
      const result = await modbus.readCoils(30, 8);
      expect(result).toHaveLength(8);
      // 0xAB = 10101011 -> [1,1,0,1,0,1,0,1]
      expect(result).toEqual([1, 1, 0, 1, 0, 1, 0, 1]);
    } finally {
      await modbus.disconnect();
    }
  });

  it("should write a holding register", async () => {
    const modbus = new SolarmanV5("127.0.0.1", TEST_SERIAL, {
      port: TEST_PORT,
      socketTimeout: 5,
    });
    await modbus.connect();
    try {
      const result = await modbus.writeHoldingRegister(100, 0x1234);
      expect(result).toBe(0x1234);
    } finally {
      await modbus.disconnect();
    }
  });

  it("should throw V5FrameError on Modbus exception from high addr", async () => {
    const modbus = new SolarmanV5("127.0.0.1", TEST_SERIAL, {
      port: TEST_PORT,
      socketTimeout: 5,
    });
    await modbus.connect();
    try {
      await expect(
        modbus.readHoldingRegisters(4500, 4)
      ).rejects.toThrow("Modbus");
    } finally {
      await modbus.disconnect();
    }
  });

  it("should read holding register formatted", async () => {
    const modbus = new SolarmanV5("127.0.0.1", TEST_SERIAL, {
      port: TEST_PORT,
      socketTimeout: 5,
    });
    await modbus.connect();
    try {
      const result = await modbus.readHoldingRegisterFormatted(20, 1);
      expect(result).toBe(100);

      const scaled = await modbus.readHoldingRegisterFormatted(20, 1, {
        scale: 0.1,
      });
      expect(scaled).toBeCloseTo(10.0);
    } finally {
      await modbus.disconnect();
    }
  });

  it("twosComplement should work correctly", () => {
    // 0xFFFF should be -1 for 16 bits
    expect(SolarmanV5.twosComplement(0xffff, 16)).toBe(-1);
    // 0x8000 should be -32768 for 16 bits
    expect(SolarmanV5.twosComplement(0x8000, 16)).toBe(-32768);
    // Positive values below threshold should stay positive
    expect(SolarmanV5.twosComplement(100, 16)).toBe(100);
  });
});
