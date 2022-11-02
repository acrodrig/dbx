export { default as EventEmitter } from "https://deno.land/x/events@v1.0.0/mod.ts";

import * as log from "https://deno.land/std@0.160.0/log/mod.ts";
import { LogLevels } from "https://deno.land/std@0.160.0/log/mod.ts";

import "../../base/src/util.ts";

const DEBUG = Deno.env.get("DEBUG") ?? "";
const CONSOLE = new log.handlers.ConsoleHandler("DEBUG");

export function getLogger(name: string, level: keyof typeof LogLevels = "INFO") {
    const logger = log.getLogger(name);
    logger.level = DEBUG.includes(name) ? LogLevels.DEBUG : LogLevels[level];
    if (!logger.handlers || logger.handlers.length === 0) logger.handlers = [CONSOLE];
    return logger;
}
