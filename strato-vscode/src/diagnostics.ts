import * as vscode from 'vscode';
import { rest, importer } from 'blockapps-rest';
import getConfig from './load.config';
import { getApplicationUser } from './auth';

let validationCounter: number = 0;

/**
 * Analyzes the text document for problems. 
 * This demo diagnostic problem provider finds all mentions of 'emoji'.
 * @param doc text document to analyze
 * @param emojiDiagnostics diagnostic collection
 */
export async function refreshDiagnostics(doc: vscode.TextDocument, solidityDiagnostics: vscode.DiagnosticCollection): Promise<void> {
  if (doc.uri.path.slice(-4) === '.sol') {
    validationCounter = (validationCounter + 1) % 10000;
    const thisCounter = validationCounter;
    setTimeout(async () => await validate(thisCounter, doc, solidityDiagnostics), 1500);
  }
}

async function validate(counter: number, doc: vscode.TextDocument, solidityDiagnostics: vscode.DiagnosticCollection): Promise<void> {
  if (validationCounter === counter) {
    try {
      const diagnostics: vscode.Diagnostic[] = [];

      const user = await getApplicationUser();
      const config = getConfig() || {};
      const options = { config };
      const annotations = await rest.debugPostAnalyze(user, [[doc.uri.path, doc.getText()]], options);

      for (let ann in annotations) {
        diagnostics.push(createDiagnostic(doc, annotations[ann]));
      }

      solidityDiagnostics.set(doc.uri, diagnostics);
    } catch (e) {
      console.log(`validate exception: ${JSON.stringify(e)}`);
    }
  }
}

function createDiagnostic(doc: vscode.TextDocument, ann: any): vscode.Diagnostic {
  const { start, end } = ann;

  // create range that represents, where in the document the word is
  const range = new vscode.Range(start.line - 1, start.column - 1, end.line - 1, end.column - 1);

  const diagnostic = new vscode.Diagnostic(range, ann.annotation,
    vscode.DiagnosticSeverity.Warning);
  diagnostic.code = '';
  return diagnostic;
}

export async function subscribeToDocumentChanges(context: vscode.ExtensionContext, solidityDiagnostics: vscode.DiagnosticCollection): Promise<void> {
  if (vscode.window.activeTextEditor) {
    await refreshDiagnostics(vscode.window.activeTextEditor.document, solidityDiagnostics);
  }
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (editor) {
        await refreshDiagnostics(editor.document, solidityDiagnostics);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(async (e) => await refreshDiagnostics(e.document, solidityDiagnostics))
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(doc => solidityDiagnostics.delete(doc.uri))
  );

}