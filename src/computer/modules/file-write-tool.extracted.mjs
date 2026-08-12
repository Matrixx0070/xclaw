/**
 * EXTRACTED from xclaw-server.mjs lines 392907-393068
 * Tool region: file-write-tool
 * Status: reference module — depends on bundle scope unless rewired.
 */
var FileWriteTool = {
  name: "xclaw_file_write",
  description: () => "Writes content to file_path, overwriting if it exists. Read existing files first.",
  inputSchema: () => inputSchema4,
  isEnabled: () => true,
  isReadOnly: () => false,
  validateInput: async ({ file_path }, context) => {
    const fullFilePath = await normalizeFilePath(file_path, await context.session.shell.pwd());
    const fileExists = await access5(fullFilePath).then(() => true).catch(() => false);
    if (!fileExists)
      return { result: true };
    const readTimestamp = context.readFileTimestamps.get(fullFilePath);
    let stats;
    try {
      stats = await stat6(fullFilePath);
    } catch (error) {
      log_default.error(error);
      return {
        result: false,
        message: `Failed to stat file: ${error.message}`
      };
    }
    if (!readTimestamp) {
      context.readFileTimestamps.set(fullFilePath, stats.mtimeMs);
      return {
        result: false,
        message: "File has not been read yet. The file might have been recently created by a teammate or external process."
      };
    }
    if (stats.mtimeMs > readTimestamp) {
      context.readFileTimestamps.set(fullFilePath, stats.mtimeMs);
      return {
        result: false,
        message: "File has been modified since last read, either by a teammate or external process."
      };
    }
    return { result: true };
  },
  async call(input, context) {
    const { file_path } = input;
    let content = input.content;
    const { readFileTimestamps } = context;
    if (context.session.unescapeInput) {
      content = fixEscapedString(content);
    }
    const fullFilePath = await normalizeFilePath(file_path, await context.session.shell.pwd());
    const release = await acquireLock(fullFilePath);
    try {
      const fileExists = await access5(fullFilePath).then(() => true).catch(() => false);
      const readTimestamp = readFileTimestamps.get(fullFilePath);
      if (fileExists) {
        const stats = await stat6(fullFilePath);
        if (!readTimestamp) {
          readFileTimestamps.set(fullFilePath, stats.mtimeMs);
          const data2 = {
            type: "error",
            filePath: file_path,
            content: "File has not been read yet. The file might have been recently created by a teammate or external process.",
            structuredPatch: []
          };
          return {
            type: "result",
            data: data2,
            resultForAssistant: this.renderResultForAssistant(data2)
          };
        }
        if (stats.mtimeMs > readTimestamp) {
          readFileTimestamps.set(fullFilePath, stats.mtimeMs);
          const data2 = {
            type: "error",
            filePath: file_path,
            content: "File has been modified since last read, either by a teammate or external process.",
            structuredPatch: []
          };
          return {
            type: "result",
            data: data2,
            resultForAssistant: this.renderResultForAssistant(data2)
          };
        }
      }
      const dir = dirname8(fullFilePath);
      const enc = fileExists ? await detectFileEncoding(fullFilePath) : "utf-8";
      const oldContent = fileExists ? await readFile7(fullFilePath, enc) : null;
      const endings = fileExists ? await detectLineEndings(fullFilePath) : await detectRepoLineEndings(await context.session.shell.pwd());
      await mkdir5(dir, { recursive: true });
      await writeTextContent(fullFilePath, content, enc, endings);
      const realFullPath = await realpath3(fullFilePath);
      const newStats = await stat6(realFullPath);
      readFileTimestamps.set(realFullPath, newStats.mtimeMs);
      if (oldContent) {
        const patch = getPatch({
          filePath: file_path,
          fileContents: oldContent,
          oldStr: oldContent,
          newStr: content
        });
        const data2 = {
          type: "update",
          filePath: file_path,
          content,
          structuredPatch: patch
        };
        return {
          type: "result",
          data: data2,
          resultForAssistant: this.renderResultForAssistant(data2)
        };
      }
      const data = {
        type: "create",
        filePath: file_path,
        content,
        structuredPatch: []
      };
      return {
        type: "result",
        data,
        resultForAssistant: this.renderResultForAssistant(data)
      };
    } catch (error) {
      log_default.error(error, { filePath: fullFilePath });
      const data = {
        type: "error",
        filePath: file_path,
        content: error.message,
        structuredPatch: []
      };
      return {
        type: "result",
        data,
        resultForAssistant: this.renderResultForAssistant(data)
      };
    } finally {
      release();
    }
  },
  renderResultForAssistant({ filePath, content, type }) {
    if (type === "error") {
      return [
        {
          type: "text",
          text: `Failed to write file: ${content}`
        }
      ];
    }
    if (type === "create") {
      return [
        {
          type: "text",
          text: `Created ${filePath}`
        }
      ];
    }
    return [
      {
        type: "text",
        text: `Updated ${filePath}`
      }
    ];
  }
};
