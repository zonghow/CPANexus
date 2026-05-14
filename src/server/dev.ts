import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

type DevProcess = {
  name: string;
  child: ChildProcess;
};

const nextArgs = process.argv.slice(2);
const children: DevProcess[] = [];
let shuttingDown = false;

start("web", localBin("next"), ["dev", ...nextArgs]);
start("worker", localBin("tsx"), ["watch", "src/server/worker.ts"]);

function start(name: string, command: string, args: string[]) {
  console.log(`[dev] starting ${name}: ${command} ${args.join(" ")}`);
  const child = spawn(command, args, {
    env: process.env,
    stdio: "inherit",
  });

  children.push({ name, child });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.log(`[dev] ${name} exited with ${reason}`);
    shutdown(code ?? 0);
  });

  child.on("error", (error) => {
    if (shuttingDown) {
      return;
    }

    console.error(`[dev] failed to start ${name}:`, error);
    shutdown(1);
  });
}

function shutdown(exitCode: number) {
  shuttingDown = true;

  for (const { child } of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => process.exit(exitCode), 300);
}

function localBin(name: string) {
  return join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
