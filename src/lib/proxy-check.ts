import net from "node:net";
import tls from "node:tls";

export type ProxyCheckResult = {
  ok: boolean;
  latencyMs: number | null;
  message: string;
};

type ProxyCheckOptions = {
  targetHost?: string;
  targetPort?: number;
  timeoutMs?: number;
};

const defaultTargetHost = "chatgpt.com";
const defaultTargetPort = 443;
const defaultTimeoutMs = 8_000;

export async function checkProxyUrl(
  proxyUrl: string,
  options: ProxyCheckOptions = {},
): Promise<ProxyCheckResult> {
  const startedAt = Date.now();
  const targetHost = options.targetHost ?? defaultTargetHost;
  const targetPort = options.targetPort ?? defaultTargetPort;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;

  try {
    const url = new URL(proxyUrl);
    const protocol = url.protocol.toLowerCase();
    if (protocol === "http:" || protocol === "https:") {
      await checkHttpConnectProxy(url, targetHost, targetPort, timeoutMs);
    } else if (protocol === "socks5:" || protocol === "socks5h:") {
      await checkSocks5Proxy(url, targetHost, targetPort, timeoutMs);
    } else {
      throw new Error(`不支持的代理协议：${protocol.replace(/:$/, "") || "unknown"}`);
    }

    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      message: "可连接",
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: null,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkHttpConnectProxy(
  proxyUrl: URL,
  targetHost: string,
  targetPort: number,
  timeoutMs: number,
) {
  const socket = await connectToProxy(proxyUrl, timeoutMs, proxyUrl.protocol === "https:");
  try {
    const target = `${targetHost}:${targetPort}`;
    const authHeader = proxyAuthHeader(proxyUrl);
    socket.write(
      [
        `CONNECT ${target} HTTP/1.1`,
        `Host: ${target}`,
        authHeader,
        "",
        "",
      ].filter((line) => line !== null).join("\r\n"),
    );

    const responseHead = await readUntil(socket, "\r\n\r\n", timeoutMs);
    const statusLine = responseHead.split("\r\n")[0] ?? "";
    const statusCode = Number(statusLine.split(/\s+/)[1]);
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(statusLine || "HTTP 代理连接失败");
    }
  } finally {
    socket.destroy();
  }
}

async function checkSocks5Proxy(
  proxyUrl: URL,
  targetHost: string,
  targetPort: number,
  timeoutMs: number,
) {
  const socket = await connectToProxy(proxyUrl, timeoutMs, false);
  const reader = new SocketReader(socket, timeoutMs);

  try {
    const username = decodeURIComponent(proxyUrl.username);
    const password = decodeURIComponent(proxyUrl.password);
    const methods = username || password ? [0x00, 0x02] : [0x00];
    socket.write(Buffer.from([0x05, methods.length, ...methods]));

    const greeting = await reader.readBytes(2);
    if (greeting[0] !== 0x05) {
      throw new Error("SOCKS5 握手失败");
    }
    if (greeting[1] === 0xff) {
      throw new Error("SOCKS5 代理不接受认证方式");
    }

    if (greeting[1] === 0x02) {
      const usernameBytes = Buffer.from(username);
      const passwordBytes = Buffer.from(password);
      if (usernameBytes.length > 255 || passwordBytes.length > 255) {
        throw new Error("SOCKS5 用户名或密码过长");
      }

      socket.write(Buffer.from([
        0x01,
        usernameBytes.length,
        ...usernameBytes,
        passwordBytes.length,
        ...passwordBytes,
      ]));
      const authResult = await reader.readBytes(2);
      if (authResult[1] !== 0x00) {
        throw new Error("SOCKS5 认证失败");
      }
    }

    const hostBytes = Buffer.from(targetHost);
    if (hostBytes.length > 255) {
      throw new Error("目标域名过长");
    }
    socket.write(Buffer.from([
      0x05,
      0x01,
      0x00,
      0x03,
      hostBytes.length,
      ...hostBytes,
      (targetPort >> 8) & 0xff,
      targetPort & 0xff,
    ]));

    const response = await reader.readBytes(4);
    if (response[1] !== 0x00) {
      throw new Error(`SOCKS5 连接失败：${socks5ReplyMessage(response[1])}`);
    }

    if (response[3] === 0x01) {
      await reader.readBytes(4);
    } else if (response[3] === 0x03) {
      const length = (await reader.readBytes(1))[0];
      await reader.readBytes(length);
    } else if (response[3] === 0x04) {
      await reader.readBytes(16);
    } else {
      throw new Error("SOCKS5 返回了未知地址类型");
    }
    await reader.readBytes(2);
  } finally {
    reader.dispose();
    socket.destroy();
  }
}

function connectToProxy(proxyUrl: URL, timeoutMs: number, secure: boolean) {
  const hostname = proxyUrl.hostname;
  const defaultPort = secure ? 443 : proxyUrl.protocol.startsWith("socks") ? 1080 : 80;
  const port = Number(proxyUrl.port || defaultPort);
  if (!hostname || !Number.isFinite(port) || port <= 0) {
    throw new Error("代理地址无效");
  }

  return new Promise<net.Socket>((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host: hostname, port, servername: hostname })
      : net.connect({ host: hostname, port });
    const cleanup = () => {
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
      socket.off("connect", onConnect);
      socket.off("secureConnect", onConnect);
    };
    const onError = (error: Error) => {
      cleanup();
      socket.destroy();
      reject(error);
    };
    const onTimeout = () => onError(new Error("代理连接超时"));
    const onConnect = () => {
      cleanup();
      socket.setTimeout(0);
      resolve(socket);
    };

    socket.setTimeout(timeoutMs);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
    socket.once(secure ? "secureConnect" : "connect", onConnect);
  });
}

function proxyAuthHeader(proxyUrl: URL) {
  if (!proxyUrl.username && !proxyUrl.password) {
    return null;
  }
  const username = decodeURIComponent(proxyUrl.username);
  const password = decodeURIComponent(proxyUrl.password);
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return `Proxy-Authorization: Basic ${token}`;
}

function readUntil(socket: net.Socket, delimiter: string, timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    let buffer = "";
    const timer = windowlessSetTimeout(() => {
      cleanup();
      reject(new Error("代理响应超时"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes(delimiter)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    socket.on("data", onData);
    socket.once("error", onError);
  });
}

class SocketReader {
  private buffer = Buffer.alloc(0);
  private waiters: Array<() => void> = [];

  constructor(
    private readonly socket: net.Socket,
    private readonly timeoutMs: number,
  ) {
    this.socket.on("data", this.onData);
  }

  async readBytes(length: number) {
    while (this.buffer.length < length) {
      await this.waitForData();
    }

    const result = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return result;
  }

  dispose() {
    this.socket.off("data", this.onData);
    this.waiters.splice(0).forEach((resolve) => resolve());
  }

  private readonly onData = (chunk: Buffer) => {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.waiters.splice(0).forEach((resolve) => resolve());
  };

  private waitForData() {
    return new Promise<void>((resolve, reject) => {
      const timer = windowlessSetTimeout(() => {
        cleanup();
        reject(new Error("代理响应超时"));
      }, this.timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.off("error", onError);
        this.waiters = this.waiters.filter((waiter) => waiter !== onData);
      };
      const onData = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      this.socket.once("error", onError);
      this.waiters.push(onData);
    });
  }
}

function socks5ReplyMessage(code: number) {
  const messages: Record<number, string> = {
    0x01: "一般性失败",
    0x02: "规则不允许",
    0x03: "网络不可达",
    0x04: "主机不可达",
    0x05: "连接被拒绝",
    0x06: "TTL 过期",
    0x07: "命令不支持",
    0x08: "地址类型不支持",
  };
  return messages[code] ?? `错误码 ${code}`;
}

function windowlessSetTimeout(callback: () => void, timeoutMs: number) {
  return setTimeout(callback, timeoutMs);
}
