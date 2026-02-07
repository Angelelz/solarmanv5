#!/usr/bin/env node

/**
 * solarman CLI – command-line interface for interacting with
 * Solarman V5 data logging sticks.
 */

import { Command } from "commander";
import { SolarmanV5 } from "./solarmanv5.js";
import { discover, scan } from "./discovery.js";
import { decode } from "./decoder.js";

const program = new Command();

program
  .name("solarman")
  .description(
    "CLI for interacting with Solarman (IGEN-Tech) v5 based solar inverter data loggers"
  )
  .version("1.0.0");

// ---------- read-input ----------

program
  .command("read-input")
  .description("Read input registers (Modbus FC 4)")
  .requiredOption("-a, --address <ip>", "IP address of the data logging stick")
  .requiredOption(
    "-s, --serial <number>",
    "Serial number of the data logging stick",
    parseInt
  )
  .requiredOption(
    "-r, --register <number>",
    "Start register address",
    parseInt
  )
  .requiredOption(
    "-q, --quantity <number>",
    "Number of registers to read",
    parseInt
  )
  .option("-p, --port <number>", "TCP port", (v: string) => parseInt(v, 10), 8899)
  .option(
    "-m, --mb-slave-id <number>",
    "Modbus slave ID",
    (v: string) => parseInt(v, 10),
    1
  )
  .option("-t, --timeout <number>", "Socket timeout in seconds", (v: string) => parseInt(v, 10), 60)
  .option("-v, --verbose", "Enable verbose logging", false)
  .action(async (opts) => {
    const modbus = new SolarmanV5(opts.address, opts.serial, {
      port: opts.port,
      mbSlaveId: opts.mbSlaveId,
      socketTimeout: opts.timeout,
      verbose: opts.verbose,
    });
    try {
      await modbus.connect();
      const result = await modbus.readInputRegisters(
        opts.register,
        opts.quantity
      );
      console.log(JSON.stringify(result));
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    } finally {
      await modbus.disconnect();
    }
  });

// ---------- read-holding ----------

program
  .command("read-holding")
  .description("Read holding registers (Modbus FC 3)")
  .requiredOption("-a, --address <ip>", "IP address of the data logging stick")
  .requiredOption(
    "-s, --serial <number>",
    "Serial number of the data logging stick",
    parseInt
  )
  .requiredOption(
    "-r, --register <number>",
    "Start register address",
    parseInt
  )
  .requiredOption(
    "-q, --quantity <number>",
    "Number of registers to read",
    parseInt
  )
  .option("-p, --port <number>", "TCP port", (v: string) => parseInt(v, 10), 8899)
  .option(
    "-m, --mb-slave-id <number>",
    "Modbus slave ID",
    (v: string) => parseInt(v, 10),
    1
  )
  .option("-t, --timeout <number>", "Socket timeout in seconds", (v: string) => parseInt(v, 10), 60)
  .option("-v, --verbose", "Enable verbose logging", false)
  .action(async (opts) => {
    const modbus = new SolarmanV5(opts.address, opts.serial, {
      port: opts.port,
      mbSlaveId: opts.mbSlaveId,
      socketTimeout: opts.timeout,
      verbose: opts.verbose,
    });
    try {
      await modbus.connect();
      const result = await modbus.readHoldingRegisters(
        opts.register,
        opts.quantity
      );
      console.log(JSON.stringify(result));
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    } finally {
      await modbus.disconnect();
    }
  });

// ---------- write-holding ----------

program
  .command("write-holding")
  .description("Write a single holding register (Modbus FC 6)")
  .requiredOption("-a, --address <ip>", "IP address of the data logging stick")
  .requiredOption(
    "-s, --serial <number>",
    "Serial number of the data logging stick",
    parseInt
  )
  .requiredOption("-r, --register <number>", "Register address", parseInt)
  .requiredOption("-V, --value <number>", "Value to write", parseInt)
  .option("-p, --port <number>", "TCP port", (v: string) => parseInt(v, 10), 8899)
  .option(
    "-m, --mb-slave-id <number>",
    "Modbus slave ID",
    (v: string) => parseInt(v, 10),
    1
  )
  .option("-t, --timeout <number>", "Socket timeout in seconds", (v: string) => parseInt(v, 10), 60)
  .option("-v, --verbose", "Enable verbose logging", false)
  .action(async (opts) => {
    const modbus = new SolarmanV5(opts.address, opts.serial, {
      port: opts.port,
      mbSlaveId: opts.mbSlaveId,
      socketTimeout: opts.timeout,
      verbose: opts.verbose,
    });
    try {
      await modbus.connect();
      const result = await modbus.writeHoldingRegister(
        opts.register,
        opts.value
      );
      console.log(JSON.stringify(result));
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    } finally {
      await modbus.disconnect();
    }
  });

// ---------- write-multiple ----------

program
  .command("write-multiple")
  .description("Write multiple holding registers (Modbus FC 16)")
  .requiredOption("-a, --address <ip>", "IP address of the data logging stick")
  .requiredOption(
    "-s, --serial <number>",
    "Serial number of the data logging stick",
    parseInt
  )
  .requiredOption(
    "-r, --register <number>",
    "Start register address",
    parseInt
  )
  .requiredOption(
    "--values <numbers...>",
    "Values to write (space separated)"
  )
  .option("-p, --port <number>", "TCP port", (v: string) => parseInt(v, 10), 8899)
  .option(
    "-m, --mb-slave-id <number>",
    "Modbus slave ID",
    (v: string) => parseInt(v, 10),
    1
  )
  .option("-t, --timeout <number>", "Socket timeout in seconds", (v: string) => parseInt(v, 10), 60)
  .option("-v, --verbose", "Enable verbose logging", false)
  .action(async (opts) => {
    const modbus = new SolarmanV5(opts.address, opts.serial, {
      port: opts.port,
      mbSlaveId: opts.mbSlaveId,
      socketTimeout: opts.timeout,
      verbose: opts.verbose,
    });
    try {
      await modbus.connect();
      const values = (opts.values as string[]).map((v: string) => parseInt(v, 10));
      const result = await modbus.writeMultipleHoldingRegisters(
        opts.register,
        values
      );
      console.log(JSON.stringify(result));
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    } finally {
      await modbus.disconnect();
    }
  });

// ---------- read-coils ----------

program
  .command("read-coils")
  .description("Read coils (Modbus FC 1)")
  .requiredOption("-a, --address <ip>", "IP address of the data logging stick")
  .requiredOption(
    "-s, --serial <number>",
    "Serial number of the data logging stick",
    parseInt
  )
  .requiredOption(
    "-r, --register <number>",
    "Start register address",
    parseInt
  )
  .requiredOption(
    "-q, --quantity <number>",
    "Number of coils to read",
    parseInt
  )
  .option("-p, --port <number>", "TCP port", (v: string) => parseInt(v, 10), 8899)
  .option(
    "-m, --mb-slave-id <number>",
    "Modbus slave ID",
    (v: string) => parseInt(v, 10),
    1
  )
  .option("-t, --timeout <number>", "Socket timeout in seconds", (v: string) => parseInt(v, 10), 60)
  .option("-v, --verbose", "Enable verbose logging", false)
  .action(async (opts) => {
    const modbus = new SolarmanV5(opts.address, opts.serial, {
      port: opts.port,
      mbSlaveId: opts.mbSlaveId,
      socketTimeout: opts.timeout,
      verbose: opts.verbose,
    });
    try {
      await modbus.connect();
      const result = await modbus.readCoils(opts.register, opts.quantity);
      console.log(JSON.stringify(result));
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    } finally {
      await modbus.disconnect();
    }
  });

// ---------- discover ----------

program
  .command("discover")
  .description("Discover Solarman data loggers on the local network")
  .option(
    "-a, --address <ip>",
    "Broadcast address",
    "255.255.255.255"
  )
  .option(
    "-t, --timeout <number>",
    "Timeout in milliseconds",
    (v: string) => parseInt(v, 10),
    1000
  )
  .action(async (opts) => {
    try {
      const loggers = await discover({
        address: opts.address,
        timeout: opts.timeout,
      });
      if (loggers.length === 0) {
        console.log("No loggers found.");
      } else {
        for (const logger of loggers) {
          console.log(
            `IP: ${logger.ip}  MAC: ${logger.mac}  Serial: ${logger.serial}`
          );
        }
      }
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ---------- scan ----------

program
  .command("scan")
  .description("Scan a broadcast address for Solarman data loggers")
  .argument("<broadcast>", "Network broadcast address")
  .option(
    "-t, --timeout <number>",
    "Timeout in milliseconds",
    (v: string) => parseInt(v, 10),
    1000
  )
  .action(async (broadcast: string, opts) => {
    try {
      const loggers = await scan(broadcast, opts.timeout);
      if (loggers.length === 0) {
        console.log("No loggers found.");
      } else {
        for (const logger of loggers) {
          console.log(
            `IP: ${logger.ip}  MAC: ${logger.mac}  Serial: ${logger.serial}`
          );
        }
      }
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ---------- register-scan ----------

program
  .command("register-scan")
  .description(
    "Scan a range of holding registers and display all non-zero values"
  )
  .requiredOption("-a, --address <ip>", "IP address of the data logging stick")
  .requiredOption(
    "-s, --serial <number>",
    "Serial number of the data logging stick",
    parseInt
  )
  .option(
    "--start <number>",
    "Start register address (decimal or 0x hex)",
    (v: string) => parseInt(v, v.startsWith("0x") ? 16 : 10),
    0
  )
  .option(
    "--end <number>",
    "End register address (decimal or 0x hex)",
    (v: string) => parseInt(v, v.startsWith("0x") ? 16 : 10),
    0x0130
  )
  .option(
    "--chunk <number>",
    "Registers to read per request (max ~40 is safe)",
    (v: string) => parseInt(v, 10),
    10
  )
  .option(
    "--delay <number>",
    "Delay between requests in milliseconds",
    (v: string) => parseInt(v, 10),
    500
  )
  .option("--all", "Show all registers including zeros", false)
  .option("-p, --port <number>", "TCP port", (v: string) => parseInt(v, 10), 8899)
  .option(
    "-m, --mb-slave-id <number>",
    "Modbus slave ID",
    (v: string) => parseInt(v, 10),
    1
  )
  .option("-t, --timeout <number>", "Socket timeout in seconds", (v: string) => parseInt(v, 10), 60)
  .option("-v, --verbose", "Enable verbose logging", false)
  .action(async (opts) => {
    const modbus = new SolarmanV5(opts.address, opts.serial, {
      port: opts.port,
      mbSlaveId: opts.mbSlaveId,
      socketTimeout: opts.timeout,
      verbose: opts.verbose,
    });
    try {
      await modbus.connect();

      const start: number = opts.start;
      const end: number = opts.end;
      const chunk: number = opts.chunk;
      const delay: number = opts.delay;
      const showAll: boolean = opts.all;

      console.log(
        `Scanning registers 0x${start.toString(16).padStart(4, "0")} ` +
          `(${start}) to 0x${end.toString(16).padStart(4, "0")} (${end})...\n`
      );
      console.log(
        `${"Addr".padStart(7)}  ${"Hex".padStart(6)}  ${"Dec".padStart(7)}  ${"Hex Value".padStart(9)}`
      );
      console.log("-".repeat(38));

      for (let addr = start; addr <= end; addr += chunk) {
        const qty = Math.min(chunk, end - addr + 1);
        try {
          const values = await modbus.readHoldingRegisters(addr, qty);
          for (let i = 0; i < values.length; i++) {
            const regAddr = addr + i;
            const val = values[i];
            if (showAll || val !== 0) {
              const addrHex = `0x${regAddr.toString(16).padStart(4, "0")}`;
              const addrDec = regAddr.toString().padStart(7);
              const valDec = val.toString().padStart(7);
              const valHex = `0x${val.toString(16).padStart(4, "0")}`;
              console.log(
                `${addrHex}  ${addrDec}  ${valDec}  ${valHex}`
              );
            }
          }
        } catch {
          // Skip ranges that return errors (invalid address segments)
        }
        if (addr + chunk <= end && delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      console.log("\nScan complete.");
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    } finally {
      await modbus.disconnect();
    }
  });

// ---------- decode ----------

program
  .command("decode")
  .description("Decode a Solarman V5 frame")
  .argument("<hex...>", "Hex bytes of the frame (e.g. a5 17 00 10 45 ...)")
  .action((hexBytes: string[]) => {
    try {
      console.log(decode(hexBytes));
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program.parse();
