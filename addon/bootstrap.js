var Margin;
var scope;

async function startup({ id, rootURI }) {
  await Zotero.initializationPromise;
  const timers = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  Cu.importGlobalProperties(["fetch", "AbortController", "TextDecoder", "TextEncoder", "URL"]);
  scope = { Zotero, Services, ChromeUtils, Components, Cu, IOUtils, PathUtils,
    fetch, AbortController, TextDecoder, TextEncoder, URL,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval,
    console: ChromeUtils.importESModule("resource://gre/modules/Console.sys.mjs").console };
  Services.scriptloader.loadSubScript(rootURI + "plugin.js", scope);
  Margin = scope.Margin;
  await Margin.startup({ id, rootURI });
}
function shutdown() { Margin?.shutdown(); Margin = undefined; scope = undefined; }
function install() {}
function uninstall() {}
function onMainWindowLoad({ window }) { Margin?.windowLoad(window); }
function onMainWindowUnload({ window }) { Margin?.windowUnload(window); }
