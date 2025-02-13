#!/usr/bin/env -S deno test -A

import { assert, assertEquals, assertMatch } from "@std/assert";
import { delay } from "jsr:@std/async";
import * as colors from "@std/fmt/colors";
import { color, DEFAULTS, hub } from "../src/hub.ts";

// We set a buffer to capture console.log messages
const buffer = DEFAULTS.buffer = [];
const reset = { ...DEFAULTS };

Deno.test("Basic", () => {
  Object.assign(DEFAULTS, { fileLine: false, icons: true, time: false });

    // DEFAULTS.time = false;
  const log = hub("test");

  // Test that we do NOT touch console.log, and default level is "info"
  log.debug("debug");
  log.info("info");
  log.warn("warn");
  log.error("error");
  log.log("log");

  // Test validity
  const prefix = color("test", true);
  assertEquals(buffer, [ [ "info", [ "🔵 " + prefix + " info" ] ], [ "warn", [ "🟡 " + prefix + " warn" ] ], [ "error", [ "🔴 " + prefix + " error" ] ] ]);
  buffer.length = 0;

  Object.assign(DEFAULTS, reset);
});

Deno.test("File/Lines and Icons (with debug level)", async () => {
  DEFAULTS.fileLine = true;
  DEFAULTS.icons = true;
  const log = hub("test", "debug");

  log.debug("debug");
  await delay(10);
  log.log("log");

  // Test validity
  const prefix = color("test", true);
  const fileLine = colors.underline(colors.white("[hub.test.ts:38]"));
  const time = buffer[0][1][1];
  assertEquals(buffer, [ [ "debug", [ "🟢 " + fileLine + " " + prefix + " debug", buffer[0][1][1] ] ] ]);
  assertMatch(time, /\+\d+\.\d+ms/);
  DEFAULTS.fileLine = false;
  DEFAULTS.icons = false;
});

Deno.test("Console Replacement", async () => {
  DEFAULTS.fileLine = true;
  DEFAULTS.icons = true;
  const log = hub("test", "debug");

  log.debug("debug");
  await delay(10);
  log.log("log");

  // Test validity
  const prefix = color("test", true);
  const fileLine = colors.underline(colors.white("[hub.test.ts:38]"));
  const time = buffer[0][1][1];
  assertEquals(buffer, [ [ "debug", [ "🟢 " + fileLine + " " + prefix + " debug", buffer[0][1][1] ] ] ]);
  assertMatch(time, /\+\d+\.\d+ms/);
  DEFAULTS.fileLine = false;
  DEFAULTS.icons = false;
});

// Deno.test("Basic sanity check", () => {
//   const log = dash("test");
//   log.info("hello world");
//   assert(() => console.log("hello world"));
// });

//
// Deno.test("debug - allows namespaces to be a non-string value", () => {
//   const log = dash("test");
//   log.enabled = true;
//   log.log = () => {};
//
//   assert(() => dash.enable(true as unknown as string));
// });
//
// Deno.test("debug - honors global debug namespace enable calls", () => {
//   assertEquals(dash("test:12345").enabled, false);
//   assertEquals(dash("test:67890").enabled, false);
//
//   dash.enable("test:12345");
//   assertEquals(dash("test:12345").enabled, true);
//   assertEquals(dash("test:67890").enabled, false);
// });
//
// Deno.test("debug - uses custom log function", () => {
//   const log = dash("test");
//   log.enabled = true;
//
//   const messages: unknown[] = [];
//   log.log = (...args: unknown[]) => messages.push(args);
//
//   log("using custom log function");
//   log("using custom log function again");
//   log("%O", 12345);
//
//   assertEquals(messages.length, 3);
// });
//
// // Extend namespace tests
// Deno.test("debug - should extend namespace", () => {
//   const log = dash("foo");
//   log.enabled = true;
//   log.log = () => {};
//
//   const logBar = log.extend("bar");
//   assertEquals(logBar.namespace, "foo:bar");
// });
//
// Deno.test("debug - should extend namespace with custom delimiter", () => {
//   const log = dash("foo");
//   log.enabled = true;
//   log.log = () => {};
//
//   const logBar = log.extend("bar", "--");
//   assertEquals(logBar.namespace, "foo--bar");
// });
//
// Deno.test("debug - should extend namespace with empty delimiter", () => {
//   const log = dash("foo");
//   log.enabled = true;
//   log.log = () => {};
//
//   const logBar = log.extend("bar", "");
//   assertEquals(logBar.namespace, "foobar");
// });
//
// Deno.test("debug - should keep the log function between extensions", () => {
//   const log = dash("foo");
//   log.log = () => {};
//
//   const logBar = log.extend("bar");
//   assertEquals(log.log, logBar.log);
// });
//
// // Rebuild namespace string (disable) tests
// Deno.test("debug - handle names, skips, and wildcards", () => {
//   dash.enable("test,abc*,-abc");
//   const namespaces = dash.disable();
//   assertEquals(namespaces, "test,abc*,-abc");
// });
//
// Deno.test("debug - handles empty", () => {
//   dash.enable("");
//   const namespaces = dash.disable();
//   assertEquals(namespaces, "");
//   assertEquals(dash.names, []);
//   assertEquals(dash.skips, []);
// });
//
// Deno.test("debug - handles all", () => {
//   dash.enable("*");
//   const namespaces = dash.disable();
//   assertEquals(namespaces, "*");
// });
//
// Deno.test("debug - handles skip all", () => {
//   dash.enable("-*");
//   const namespaces = dash.disable();
//   assertEquals(namespaces, "-*");
// });
//
// Deno.test("debug - names+skips same with new string", () => {
//   dash.enable("test,abc*,-abc");
//   const oldNames = [...dash.names];
//   const oldSkips = [...dash.skips];
//   const namespaces = dash.disable();
//   assertEquals(namespaces, "test,abc*,-abc");
//   dash.enable(namespaces);
//   assertEquals(oldNames.map(String), dash.names.map(String));
//   assertEquals(oldSkips.map(String), dash.skips.map(String));
// });
//
// Deno.test("debug - handles re-enabling existing instances", () => {
//   dash.disable("*");
//   const inst = dash("foo");
//   const messages: string[] = [];
//   inst.log = (msg: string) => messages.push(msg.replace(/^[^@]*@([^@]+)@.*$/, "$1"));
//
//   inst("@test@");
//   assertEquals(messages, []);
//   dash.enable("foo");
//   assertEquals(messages, []);
//   inst("@test2@");
//   assertEquals(messages, ["test2"]);
//   inst("@test3@");
//   assertEquals(messages, ["test2", "test3"]);
//   dash.disable("*");
//   inst("@test4@");
//   assertEquals(messages, ["test2", "test3"]);
// });
