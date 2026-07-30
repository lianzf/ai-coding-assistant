const assert = require("node:assert/strict");
const vscode = require("vscode");

async function run() {
  const extension = vscode.extensions.getExtension("local-project.ai-coding-assistant");
  assert.ok(extension, "extension is discoverable");
  await extension.activate();
  assert.equal(extension.isActive, true, "extension activates");

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "aiCodingAssistant.openChat",
    "aiCodingAssistant.configureModel",
    "aiCodingAssistant.generateTests",
    "aiCodingAssistant.runTests",
    "aiCodingAssistant.previewPendingChange",
    "aiCodingAssistant.applyPendingChange",
  ]) {
    assert.ok(commands.includes(command), `${command} is registered`);
  }

  const views = extension.packageJSON.contributes.views.aiCodingAssistant;
  assert.ok(
    views.some((view) => view.id === "aiCodingAssistant.chatView"),
    "chat view is contributed",
  );
  assert.ok(
    views.some((view) => view.id === "aiCodingAssistant.modelsView"),
    "models view is contributed separately",
  );
}

module.exports = { run };
