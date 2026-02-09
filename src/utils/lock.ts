import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { createLogger } from "./logger.js";

const log = createLogger("lock");

interface LockData {
  pid: number;
  timestamp: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(lockPath: string): boolean {
  if (existsSync(lockPath)) {
    try {
      const raw = readFileSync(lockPath, "utf-8");
      const data = JSON.parse(raw) as LockData;

      if (isProcessAlive(data.pid)) {
        log.warn("Lock held by live process", { pid: data.pid, since: data.timestamp });
        return false;
      }

      log.warn("Removing stale lock from dead process", { pid: data.pid, since: data.timestamp });
      unlinkSync(lockPath);
    } catch {
      log.warn("Removing unreadable lock file");
      unlinkSync(lockPath);
    }
  }

  const lockData: LockData = {
    pid: process.pid,
    timestamp: new Date().toISOString(),
  };

  writeFileSync(lockPath, JSON.stringify(lockData), "utf-8");
  return true;
}

export function releaseLock(lockPath: string): void {
  try {
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
    }
  } catch (err) {
    log.error("Failed to release lock", { error: String(err) });
  }
}
