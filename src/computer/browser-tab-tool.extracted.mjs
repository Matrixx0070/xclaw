/**
 * EXTRACTED REFERENCE — xclaw_browser_tab tool from xclaw-server.mjs
 *
 * Not yet a standalone runnable module (depends on bundle helpers:
 * truncate, captureScreenshot, formatErrorMessage, session.browser, …).
 * Kept as the editable *text of record* for the navigate/evaluate path
 * so A2 hooks can be designed against real call sites (Page.navigate, etc.).
 *
 * Clean BrowserService lives in browser-service.mjs (syntax-checked, importable).
 */

var BrowserTabTool = {
  name: "xclaw_browser_tab",
  description: (context) => {
    if (context?.session.hasVision) {
      return "Loads a URL or interacts with an existing tab. Optionally runs JS and captures network, console logs, and screenshots.";
    }
    return "Loads a URL or interacts with an existing tab. Optionally runs JS and captures network and console logs.";
  },
  inputSchema: (context) => {
    return context?.session.hasVision ? visionSchema : nonVisionSchema;
  },
  isReadOnly: () => false,
  isEnabled: () => true,
  renderResultForAssistant: (data) => {
    const tabIdSuffix = data.tabRecreated ? " (new tab \u2014 previous tabId was no longer open)" : "";
    const sections = [
      {
        type: "text",
        text: `Tab ID: ${data.tabId}${tabIdSuffix}`
      }
    ];
    if (data.error) {
      sections.push({
        type: "text",
        text: `Error: ${data.error}`
      });
    }
    if (data.result !== void 0) {
      sections.push({ type: "text", text: `Result: ${data.result}` });
    } else if (data.resultFile) {
      sections.push({ type: "text", text: `Result: ${data.resultFile}` });
    }
    if (data.consoleLogs.length) {
      sections.push({
        type: "text",
        text: `Console Logs:
${data.consoleLogs.map((log2) => `[${log2.type}] ${truncate(log2.message, 1e4)}`).join("\n")}`
      });
    }
    if (data.networkSummaries?.length) {
      sections.push({
        type: "text",
        text: `Network Summaries:
${data.networkSummaries.map((network) => `[id: ${network.requestId}] ${network.method} ${truncate(network.url, 500)} (${network.status || "Pending"})`).join("\n")}`
      });
    }
    if (data.screenshots?.mobile) {
      const s = data.screenshots.mobile;
      sections.push({
        type: "text",
        text: `Mobile Screenshot (${s.pixelWidth}\xD7${s.pixelHeight} viewport, page height: ${s.pageHeight}px, scrollY: ${s.scrollY}px):`
      });
      sections.push({
        type: "image",
        data: s.base64,
        mimeType: "image/png"
      });
    }
    if (data.screenshots?.desktop) {
      const s = data.screenshots.desktop;
      sections.push({
        type: "text",
        text: `Desktop Screenshot (${s.pixelWidth}\xD7${s.pixelHeight} viewport, page height: ${s.pageHeight}px, scrollY: ${s.scrollY}px):`
      });
      sections.push({
        type: "image",
        data: s.base64,
        mimeType: "image/png"
      });
    }
    const joined = sections.reduce((acc, block, idx) => {
      if (idx > 0 && block.type === "text") {
        acc.push({ type: "text", text: "\n\n" });
      }
      acc.push(block);
      return acc;
    }, []);
    return joined;
  },
  call: async function(input, context) {
    const { tabId: providedTabId, url, refresh = false, jsCode, timeout = 5, waitTime = 2, includeNetwork, includeLogs } = input;
    let screenshot;
    if ("screenshot" in input) {
      screenshot = input.screenshot;
    }
    const output = {
      tabId: "",
      consoleLogs: []
    };
    if (screenshot && !context?.session.hasVision) {
      output.error = "Cannot capture screenshots";
      return {
        type: "result",
        data: output,
        resultForAssistant: this.renderResultForAssistant(output)
      };
    }
    const effectiveTimeout = computeEffectiveTimeout(timeout, waitTime, jsCode);
    try {
      const browser = context.session.browser;
      const client = await browser.ensureRunning();
      let tabId;
      let tabRecreated = false;
      if (!providedTabId) {
        const { targetId: chromeTargetId2 } = await client.Target.createTarget({
          url: "about:blank"
        });
        tabId = browser.allocateTabId();
        browser.openTabs.set(tabId, {
          url: url ?? "about:blank",
          createdAt: /* @__PURE__ */ new Date(),
          chromeTargetId: chromeTargetId2
        });
      } else {
        const resolved = browser.resolveTabId(providedTabId);
        if (resolved) {
          tabId = resolved;
        } else if (url) {
          const { targetId: chromeTargetId2 } = await client.Target.createTarget({ url: "about:blank" });
          tabId = browser.allocateTabId();
          browser.openTabs.set(tabId, {
            url,
            createdAt: /* @__PURE__ */ new Date(),
            chromeTargetId: chromeTargetId2
          });
          tabRecreated = true;
        } else {
          throw new Error("Invalid tabId: Tab not found");
        }
      }
      output.tabId = tabId;
      const chromeTargetId = browser.openTabs.get(tabId).chromeTargetId;
      const runWithTabClient = async () => {
        const tabClient = await (0, import_chrome_remote_interface3.default)({
          host: "127.0.0.1",
          port: browser.chromePort,
          target: chromeTargetId
        });
        try {
          await tabClient.Page.enable();
          await tabClient.Runtime.enable();
          const consoleLogs = setupConsoleLogCollection(tabClient);
          const navState = {};
          let mainLoaderId;
          const requestLoaderIds = /* @__PURE__ */ new Map();
          await tabClient.Network.enable();
          tabClient.Network.requestWillBeSent((event) => {
            if (event.loaderId) {
              requestLoaderIds.set(event.requestId, event.loaderId);
            }
          });
          tabClient.Network.loadingFailed((event) => {
            if (event.type !== "Document")
              return;
            if (navState.loadingFailedText)
              return;
            const requestLoaderId = requestLoaderIds.get(event.requestId);
            if (mainLoaderId !== void 0 && requestLoaderId === void 0) {
              return;
            }
            if (requestLoaderId !== void 0 && mainLoaderId !== void 0 && requestLoaderId !== mainLoaderId) {
              return;
            }
            navState.loadingFailedText = event.errorText;
            navState.loadingBlockedReason = event.blockedReason;
          });
          tabClient.Page.frameNavigated((event) => {
            if (event.frame.parentId)
              return;
            if (event.frame.unreachableUrl && !navState.unreachableUrl) {
              navState.unreachableUrl = event.frame.unreachableUrl;
              navState.frameErrorUrl = event.frame.url;
            }
          });
          const networkData = /* @__PURE__ */ new Map();
          let bodyPromises = [];
          if (includeNetwork) {
            bodyPromises = setupNetworkMonitoring(tabClient, networkData, effectiveTimeout * 1e3);
          }
          if (url || refresh && browser.openTabs.get(tabId).url) {
            const navigateUrl = url || browser.openTabs.get(tabId).url;
            navState.attemptedUrl = navigateUrl;
            const navResult = await tabClient.Page.navigate({
              url: navigateUrl
            });
            if (navResult?.loaderId) {
              mainLoaderId = navResult.loaderId;
            }
            if (navResult?.errorText) {
              navState.navigateErrorText = navResult.errorText;
            }
            await tabClient.Page.loadEventFired();
            browser.openTabs.get(tabId).url = navigateUrl;
          }
          await new Promise((resolve6) => setTimeout(resolve6, waitTime * 1e3));
          let evalResult;
          if (jsCode) {
            const expression = wrapJsCode(jsCode);
            const evalPromise = tabClient.Runtime.evaluate({
              expression,
              returnByValue: true,
              awaitPromise: true
            });
            const timeoutPromise = new Promise((_, reject2) => setTimeout(() => reject2(new Error("Timeout")), effectiveTimeout * 1e3));
            evalResult = await Promise.race([
              evalPromise,
              timeoutPromise
            ]);
          }
          if (includeNetwork) {
            await Promise.all(bodyPromises);
          }
          let screenshotData;
          if (screenshot) {
            screenshotData = await captureScreenshot(tabClient, screenshot);
          }
          return {
            ok: true,
            consoleLogs,
            networkData,
            screenshotData,
            evalResult,
            navigationError: composeNavigationError(navState)
          };
        } finally {
          await tabClient.close();
        }
      };
      let inner;
      try {
        inner = await runWithTabClient();
      } catch (firstErr) {
        if (!isRecoverableConnectionError(firstErr))
          throw firstErr;
        inner = await runWithTabClient();
      }
      if (inner.evalResult) {
        let resultStr;
        let isError = false;
        if (inner.evalResult.exceptionDetails?.exception?.description) {
          resultStr = inner.evalResult.exceptionDetails.exception.description;
          isError = true;
        } else if (inner.evalResult.exceptionDetails) {
          resultStr = inner.evalResult.exceptionDetails.text;
          isError = true;
        } else {
          try {
            const value = inner.evalResult.result.value;
            if (value === void 0) {
              resultStr = "undefined";
            } else {
              resultStr = JSON.stringify(value, (_key, v) => typeof v === "bigint" ? v.toString() : v, 2);
            }
          } catch (stringifyError) {
            resultStr = `Result not serializable: ${stringifyError.message}`;
          }
        }
        if (isError) {
          output.error = resultStr;
        } else if (resultStr.length <= INLINE_RESULT_THRESHOLD) {
          output.result = resultStr;
        } else {
          const tempDir = await mkdtemp3(path5.join(shortTmpdir(), "xclaw-js-"));
          const resultPath = path5.join(tempDir, "result.json");
          await writeFile4(resultPath, resultStr);
          output.resultFile = resultPath;
        }
      }
      if (inner.navigationError) {
        output.error = output.error ? `${inner.navigationError}
${output.error}` : inner.navigationError;
      }
      if (includeNetwork) {
        output.networkSummaries = Array.from(inner.networkData.values()).map((item) => ({
          url: item.url,
          method: item.method,
          status: item.status,
          requestId: item.requestId
        }));
        browser.networkDataPerTab.set(tabId, inner.networkData);
      }
      if (inner.screenshotData) {
        output.screenshots = {
          mobile: inner.screenshotData.mobile,
          desktop: inner.screenshotData.desktop
        };
      }
      if (includeLogs)
        output.consoleLogs = inner.consoleLogs;
      if (tabRecreated)
        output.tabRecreated = true;
      return {
        type: "result",
        data: output,
        resultForAssistant: this.renderResultForAssistant(output)
      };
    } catch (outerError) {
      const isInitFailure = isInvalidTabError(outerError) || /ensureRunning|createTarget|CDP|Browser /i.test(outerError instanceof Error ? outerError.message : String(outerError));
      output.error = formatErrorMessage(outerError, isInitFailure ? "Failed to initialize browser or tab" : "Failed to interact with browser tab");
      return {
        type: "result",
        data: output,
        resultForAssistant: this.renderResultForAssistant(output)
      };
    }
  }
};

// build/tools/FileEditTool/fileEditTool.js
import { access as access3, mkdir as mkdir4, readFile as readFile5, stat as stat4, realpath as realpath2 } from "fs/promises";
import { dirname as dirname7, isAbsolute as isAbsolute3, basename as basename4, join as join10 } from "path";

// node_modules/diff/libesm/diff/base.js