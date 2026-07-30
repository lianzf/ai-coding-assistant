import type * as vscode from "vscode";
import { activateExtension } from "./extension/activation.js";

export function activate(context: vscode.ExtensionContext): void {
  activateExtension(context);
}

export function deactivate(): void {
  // All runtime resources are owned by ExtensionContext.subscriptions.
}
