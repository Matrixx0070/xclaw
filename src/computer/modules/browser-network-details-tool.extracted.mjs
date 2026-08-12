/**
 * EXTRACTED from xclaw-server.mjs lines 383406-383537
 * Tool region: browser-network-details-tool
 * Status: reference module — depends on bundle scope unless rewired.
 */
var BrowserNetworkDetailsTool = {
  name: "xclaw_browser_network_details",
  description: () => "Returns headers and body for a network request captured by browser_tab (requires includeNetwork=true). Writes files and returns paths.",
  inputSchema: () => schema,
  isReadOnly: () => true,
  isEnabled: () => true,
  renderResultForAssistant: (data) => {
    const sections = [];
    if (data.tabId) {
      sections.push({
        type: "text",
        text: `Tab ID: ${data.tabId}`
      });
    }
    if (data.result) {
      sections.push({
        type: "text",
        text: `Result: ${data.result}`
      });
    }
    if (data.networkDetails) {
      const details = data.networkDetails;
      const networkInfo = [
        "Request ID: " + (details.requestId ?? "N/A"),
        "URL: " + (details.url ?? "N/A"),
        "Method: " + (details.method ?? "N/A"),
        "Status: " + (details.status ?? "N/A")
      ];
      if (details.responseBodyError) {
        networkInfo.push("Response Body Error: " + details.responseBodyError);
      }
      sections.push({
        type: "text",
        text: "Network Details:\n" + networkInfo.join("\n")
      });
    }
    if (data.files) {
      const fileLines = [
        "Files:",
        `  Request Headers: ${data.files.requestHeaders}`
      ];
      if (data.files.requestBody) {
        fileLines.push(`  Request Body: ${data.files.requestBody}`);
      }
      fileLines.push(`  Response Headers: ${data.files.responseHeaders}`);
      if (data.files.responseBody) {
        fileLines.push(`  Response Body: ${data.files.responseBody}`);
      }
      sections.push({
        type: "text",
        text: fileLines.join("\n")
      });
    }
    const joined = sections.reduce((acc, block, idx) => {
      if (idx > 0 && block.type === "text") {
        acc.push({ type: "text", text: "\n\n" });
      }
      acc.push(block);
      return acc;
    }, []);
    return joined.length ? joined : [{ type: "text", text: "No data captured." }];
  },
  call: async function(input, context) {
    const browser = context.session.browser;
    const output = {};
    try {
      const { tabId: providedTabId, requestId } = input;
      if (!providedTabId)
        throw new Error(ERROR_MESSAGES.TAB_ID_REQUIRED);
      const tabId = browser.resolveTabId(providedTabId);
      if (!tabId)
        throw new Error(ERROR_MESSAGES.INVALID_TAB_ID);
      output.tabId = tabId;
      const networkMap = browser.networkDataPerTab.get(tabId);
      if (!networkMap) {
        throw new Error("No network data available for this tab. Call browser_tab with includeNetwork=true first.");
      }
      let effectiveRequestId = requestId;
      if (!effectiveRequestId) {
        const allRequests = Array.from(networkMap.keys());
        if (allRequests.length === 0) {
          throw new Error("No requests found in this tab.");
        }
        effectiveRequestId = allRequests[allRequests.length - 1];
      }
      const storedData = networkMap.get(effectiveRequestId);
      if (!storedData) {
        throw new Error("Request ID " + effectiveRequestId + " not found.");
      }
      output.networkDetails = {
        requestId: effectiveRequestId,
        url: storedData.url,
        method: storedData.method,
        status: storedData.status,
        responseBodyError: storedData.responseBodyError
      };
      const tempDir = await mkdtemp2(path4.join(shortTmpdir(), "xclaw-net-"));
      const requestHeadersPath = path4.join(tempDir, "req.json");
      await writeFile3(requestHeadersPath, JSON.stringify(storedData.requestHeaders ?? {}, null, 2));
      const responseHeadersPath = path4.join(tempDir, "res.json");
      await writeFile3(responseHeadersPath, JSON.stringify(storedData.responseHeaders ?? {}, null, 2));
      output.files = {
        requestHeaders: requestHeadersPath,
        responseHeaders: responseHeadersPath
      };
      if (storedData.requestBody !== void 0) {
        const requestBodyPath = path4.join(tempDir, "req-body");
        await writeFile3(requestBodyPath, storedData.requestBody);
        output.files.requestBody = requestBodyPath;
      }
      if (storedData.responseBody !== void 0) {
        const responseBodyPath = path4.join(tempDir, "res-body");
        const bodyContent = storedData.responseBodyBase64Encoded ? Buffer.from(storedData.responseBody, "base64") : storedData.responseBody;
        await writeFile3(responseBodyPath, bodyContent);
        output.files.responseBody = responseBodyPath;
      }
      return {
        type: "result",
        data: output,
        resultForAssistant: this.renderResultForAssistant(output)
      };
    } catch (error) {
      const errorMessage = formatErrorMessage(error, "Failed to get network details");
      output.result = errorMessage;
      return {
        type: "result",
        data: output,
        resultForAssistant: this.renderResultForAssistant(output)
      };
    }
  }
};
