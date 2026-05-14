import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { checkProxyUrl } from "./proxy-check";

const servers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("checkProxyUrl", () => {
  it("checks an HTTP CONNECT proxy", async () => {
    const server = await listen((socket) => {
      socket.once("data", (chunk) => {
        expect(chunk.toString("utf8")).toContain("CONNECT example.com:443 HTTP/1.1");
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      });
    });

    const result = await checkProxyUrl(`http://127.0.0.1:${server.port}`, {
      targetHost: "example.com",
      timeoutMs: 500,
    });

    expect(result).toMatchObject({ ok: true, message: "可连接" });
    expect(result.latencyMs).toEqual(expect.any(Number));
  });

  it("reports HTTP CONNECT proxy failures", async () => {
    const server = await listen((socket) => {
      socket.once("data", () => {
        socket.write("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
      });
    });

    const result = await checkProxyUrl(`http://127.0.0.1:${server.port}`, {
      targetHost: "example.com",
      timeoutMs: 500,
    });

    expect(result).toEqual({
      ok: false,
      latencyMs: null,
      message: "HTTP/1.1 407 Proxy Authentication Required",
    });
  });

  it("checks a SOCKS5 proxy with username and password", async () => {
    const server = await listen((socket) => {
      let step = 0;
      socket.on("data", (chunk) => {
        if (step === 0) {
          expect([...chunk]).toEqual([0x05, 0x02, 0x00, 0x02]);
          socket.write(Buffer.from([0x05, 0x02]));
          step += 1;
          return;
        }

        if (step === 1) {
          expect(chunk[0]).toBe(0x01);
          socket.write(Buffer.from([0x01, 0x00]));
          step += 1;
          return;
        }

        expect(chunk.subarray(0, 5)).toEqual(Buffer.from([0x05, 0x01, 0x00, 0x03, 0x0b]));
        expect(chunk.subarray(5, 16).toString("utf8")).toBe("example.com");
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0x1f, 0x90]));
      });
    });

    const result = await checkProxyUrl(`socks5://user:pass@127.0.0.1:${server.port}`, {
      targetHost: "example.com",
      targetPort: 443,
      timeoutMs: 500,
    });

    expect(result).toMatchObject({ ok: true, message: "可连接" });
  });
});

async function listen(onConnection: (socket: net.Socket) => void) {
  const server = net.createServer(onConnection);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to listen");
  }
  return { server, port: address.port };
}
