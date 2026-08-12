/**
 * EXTRACTED from xclaw-server.mjs lines 392733-392844
 * Tool region: file-read-tool
 * Status: reference module — depends on bundle scope unless rewired.
 */
var FileReadTool = {
  name: "xclaw_file_read",
  description: getDescription,
  inputSchema: () => inputSchema3,
  isReadOnly: () => true,
  isEnabled: () => true,
  validateInput: async ({ file_path }, context) => {
    const fullFilePath = await normalizeFilePath(file_path, await context.session.shell.pwd());
    let exists;
    try {
      await access4(fullFilePath);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) {
      const similarFilename = await findSimilarFile(fullFilePath);
      let message = "File does not exist.";
      if (similarFilename) {
        message += ` Did you mean ${similarFilename}?`;
      }
      return { result: false, message };
    }
    const ext2 = path8.extname(fullFilePath).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext2) && !context.session.hasVision) {
      return {
        result: false,
        message: "Error: Cannot read images"
      };
    }
    return { result: true };
  },
  async call(input, context) {
    const { file_path, offset = 1, limit = MAX_LINES_TO_READ } = input;
    const { readFileTimestamps } = context;
    const ext2 = path8.extname(file_path).toLowerCase();
    const fullFilePath = await normalizeFilePath(file_path, await context.session.shell.pwd());
    if (IMAGE_EXTENSIONS.has(ext2) && !context.session.hasVision) {
      const data2 = {
        type: "error",
        text: "Error: Cannot read images"
      };
      return {
        type: "result",
        data: data2,
        resultForAssistant: this.renderResultForAssistant(data2)
      };
    }
    const stats = await stat5(fullFilePath);
    readFileTimestamps.set(fullFilePath, stats.mtimeMs);
    let data;
    if (IMAGE_EXTENSIONS.has(ext2)) {
      try {
        data = await readImage(fullFilePath);
      } catch (e) {
        data = {
          type: "error",
          text: `Error: Failed to process image file "${file_path}" - it may be invalid or corrupted: ${e.message}`
        };
      }
      return {
        type: "result",
        data,
        resultForAssistant: this.renderResultForAssistant(data)
      };
    }
    const lineOffset = offset === 0 ? 0 : offset - 1;
    const { content, lineCount, totalLines } = await readTextContent(fullFilePath, lineOffset, limit);
    const contentSize = Buffer.byteLength(content, "utf8");
    if (contentSize > MAX_OUTPUT_SIZE) {
      data = {
        type: "error",
        text: formatFileSizeError(contentSize)
      };
    } else {
      data = {
        type: "text",
        file: {
          filePath: file_path,
          content,
          numLines: lineCount,
          startLine: offset,
          totalLines
        }
      };
    }
    return {
      type: "result",
      data,
      resultForAssistant: this.renderResultForAssistant(data)
    };
  },
  renderResultForAssistant(data) {
    if (data.type === "error")
      return [{ type: "text", text: data.text }];
    if (data.type === "image") {
      return [
        {
          type: "image",
          data: data.file.base64,
          mimeType: data.file.type
        }
      ];
    }
    return [
      {
        type: "text",
        text: addLineNumbers(data.file)
      }
    ];
  }
};
