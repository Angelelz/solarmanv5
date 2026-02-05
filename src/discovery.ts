/**
 * Solarman data logger discovery via UDP broadcast.
 *
 * Sends discovery messages to find Solarman data loggers on the local network.
 */

import dgram from "node:dgram";

export const DISCOVERY_PORT = 48899;
export const DISCOVERY_MESSAGES = [
  "WIFIKIT-214028-READ",
  "HF-A11ASSISTHREAD",
];

export interface DiscoveredLogger {
  ip: string;
  mac: string;
  serial: number;
}

export interface DiscoverOptions {
  /** Broadcast address. Default: "255.255.255.255" */
  address?: string;
  /** Timeout in milliseconds. Default: 1000 */
  timeout?: number;
}

/**
 * Discover Solarman data loggers on the local network.
 *
 * Sends UDP broadcast discovery messages and collects responses.
 *
 * @param options  Discovery options
 * @returns Array of discovered loggers
 */
export async function discover(
  options: DiscoverOptions = {}
): Promise<DiscoveredLogger[]> {
  const address = options.address ?? "255.255.255.255";
  const timeout = options.timeout ?? 1000;

  return new Promise((resolve, reject) => {
    const results: DiscoveredLogger[] = [];
    const seen = new Set<number>();

    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    const timer = setTimeout(() => {
      socket.close();
      resolve(results);
    }, timeout);

    socket.on("error", (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.on("message", (msg) => {
      const decoded = msg.toString();
      const parts = decoded.split(",");
      if (parts.length === 3) {
        const serial = parseInt(parts[2], 10);
        if (!isNaN(serial) && serial > 0 && !seen.has(serial)) {
          seen.add(serial);
          results.push({
            ip: parts[0],
            mac: parts[1],
            serial,
          });
        }
      }
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      for (const message of DISCOVERY_MESSAGES) {
        const buf = Buffer.from(message);
        socket.send(buf, 0, buf.length, DISCOVERY_PORT, address);
      }
    });
  });
}

/**
 * Scan a specific broadcast address for Solarman data loggers.
 * A simpler interface that just takes a broadcast address string.
 */
export async function scan(
  broadcastAddress: string,
  timeout = 1000
): Promise<DiscoveredLogger[]> {
  return discover({ address: broadcastAddress, timeout });
}
