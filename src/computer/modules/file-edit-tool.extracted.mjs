/**
 * EXTRACTED from xclaw-server.mjs lines 392505-392662
 * Tool region: file-edit-tool
 * Status: reference module — depends on bundle scope unless rewired.
 */
var FileEditTool = {
  name: "xclaw_file_edit",
  description: () => "Replaces old_string with new_string in file_path. Read the file first.",
  inputSchema: () => inputSchema2,
  isEnabled: () => true,
  isReadOnly: () => false,
  validateInput: async (input, context) => {
    const { file_path, replace_all = false } = input;
    let old_string = input.old_string;
    let new_string = input.new_string;
    if (context.session.unescapeInput) {
      old_string = fixEscapedString(old_string);
      new_string = fixEscapedString(new_string);
    }
    if (old_string === new_string) {
      return {
        result: false,
        message: "No changes to make: old_string and new_string are exactly the same.",
        meta: {
          old_string
        }
      };
    }
    const fullFilePath = await normalizeFilePath(file_path, await context.session.shell.pwd());
    const validated = await validateEdit({
      file_path,
      old_string,
      replace_all,
      fullFilePath,
      readFileTimestamps: context.readFileTimestamps
    });
    if (!validated.success) {
      return {
        result: false,
        message: validated.message,
        meta: validated.meta
      };
    }
    return { result: true };
  },
  async call(input, context) {
    const { file_path, replace_all = false, show_diff = false } = input;
    let old_string = input.old_string;
    let new_string = input.new_string;
    const { readFileTimestamps } = context;
    if (context.session.unescapeInput) {
      old_string = fixEscapedString(old_string);
      new_string = fixEscapedString(new_string);
    }
    const fullFilePath = await normalizeFilePath(file_path, await context.session.shell.pwd());
    const release = await acquireLock(fullFilePath);
    try {
      const validated = await validateEdit({
        file_path,
        old_string,
        replace_all,
        fullFilePath,
        readFileTimestamps
      });
      if (!validated.success) {
        return {
          type: "result",
          data: {
            filePath: file_path,
            oldString: old_string,
            newString: new_string,
            replaceAll: replace_all,
            showDiff: show_diff,
            originalFile: "",
            updatedFile: "",
            structuredPatch: []
          },
          resultForAssistant: [{ type: "text", text: validated.message }]
        };
      }
      let structuredPatch2;
      let updatedFile;
      let originalFile;
      try {
        const result = await applyEdit(file_path, old_string, new_string, replace_all, await context.session.shell.pwd(), validated.originalFile);
        structuredPatch2 = result.patch;
        updatedFile = result.updatedFile;
        originalFile = result.originalFile;
      } catch (error) {
        if (error instanceof Error && error.message === "Original and edited file match exactly. Failed to apply edit.") {
          return {
            type: "result",
            data: {
              filePath: file_path,
              oldString: old_string,
              newString: new_string,
              replaceAll: replace_all,
              showDiff: show_diff,
              originalFile: "",
              updatedFile: "",
              structuredPatch: []
            },
            resultForAssistant: [
              {
                type: "text",
                text: "Original and edited file match exactly. Failed to apply edit."
              }
            ]
          };
        }
        throw error;
      }
      const dir = dirname7(fullFilePath);
      await mkdir4(dir, { recursive: true });
      const realDir = await realpath2(dir);
      const fileExists = originalFile !== "";
      const encForWrite = fileExists ? await detectFileEncoding(fullFilePath) : "utf8";
      const endings = fileExists ? await detectLineEndings(fullFilePath) : "LF";
      await writeTextContent(fullFilePath, updatedFile, encForWrite, endings);
      const realFullPath = join10(realDir, basename4(fullFilePath));
      const newStats = await stat4(fullFilePath);
      readFileTimestamps.set(realFullPath, newStats.mtimeMs);
      const data = {
        filePath: file_path,
        oldString: old_string,
        newString: new_string,
        replaceAll: replace_all,
        showDiff: show_diff,
        originalFile,
        updatedFile,
        structuredPatch: structuredPatch2
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
  renderResultForAssistant({ filePath, showDiff, structuredPatch: structuredPatch2 }) {
    if (!showDiff) {
      return [{ type: "text", text: `Edited ${filePath} successfully.` }];
    }
    let result = `Edited ${filePath}:
`;
    structuredPatch2.forEach((hunk) => {
      result += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@
`;
      hunk.lines.forEach((line) => {
        result += `${line}
`;
      });
    });
    return [
      {
        type: "text",
        text: result
      }
    ];
  }
};
