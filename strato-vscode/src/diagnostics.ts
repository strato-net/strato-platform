import * as vscode from 'vscode';
import { rest, importer } from 'blockapps-rest';
import getConfig from './load.config';
import { getApplicationUser } from './auth';
import { LOADIPHLPAPI } from 'dns';

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

/**
 * Analyzes the text document for dead code. 
 * This detector finds all instances of dead code.
 * @param doc text document to analyze
 */
async function findDeadCode(srcArr: Array<Array<string>>): Promise<Array<Object>> {  
  const user = await getApplicationUser();
  const config = getConfig() || {};
  const options = { config };

  const contractAST = await rest.debugPostParse(user, srcArr, options);
  
  let privFuncs = Array();
  let searchFuncs = Array();
  let deadFuncs = Array();

  // Go through all contracts in file one by one (in case there are multiple)
  for(let contractName in contractAST._contracts) {

    const contractFunctions = contractAST._contracts[contractName]._functions;                  //Save JSON object containing functions of a contract

    for (let key in contractFunctions) {      
      searchFuncs.push(contractAST._contracts[contractName]._functions[key].funcContents);    //Save functions from JSON to an array.
      if(contractFunctions[key].funcVisibility != 'Public') {                                 // Distinguish which functions are not Public
        privFuncs.push({
          'funcName': key, 
          'start': {
            'line': contractFunctions[key].funcContext.start.line, 
            'column': contractFunctions[key].funcContext.start.column, 
            'name': contractFunctions[key].funcContext.start.name
          }, 
          'end': {
            'line': contractFunctions[key].funcContext.end.line,
            'column':  contractFunctions[key].funcContext.end.column,
            'name': contractFunctions[key].funcContext.end.name
          }});
      }
    }

    // Search through all functions in the contract to see if it used or if it is dead code
    for(let i = 0; i < privFuncs.length; ++i) {
      for(let j = 0; j < searchFuncs.length; ++j) {
        if(searchFuncs[j].length != 0) {
          for(let k = 0; k < searchFuncs[j].length; ++k) {
            if(searchFuncs[j][k].contents[0].contents.tag === 'FunctionCall') {
              
              // If the private function is used, it is not dead code. Remove from array.
              // original if statement is searchFuncs[j][k].contents[0].contents.contents[0].contents
              if(searchFuncs[j][k].contents[0].contents.contents[1].contents[1] == privFuncs[i].funcName) {
                privFuncs.splice(i,1);
              }
            }
          }

        }
      }
    }
    // If there are still any private functions in the array, it is considered dead code at this point
    if( privFuncs.length != 0) {
      for(let i = 0; i < privFuncs.length; ++i) {
        if (privFuncs.length != 0) {
          deadFuncs.push({
            'annotation': `The function '${privFuncs[i].funcName}' in contract '${contractName}' is never used and should be removed`,
            'start': {
              'line': privFuncs[i].start.line,
              'column': privFuncs[i].start.column,
              'name': privFuncs[i].start.name
            },
            'end': {
              'line': privFuncs[i].end.line,
              'column': privFuncs[i].end.column,
              'name': privFuncs[i].end.name
            }
          })
        }
      }
    }
    // Reset arrays for the next contract
    privFuncs = Array();
    searchFuncs = Array();
  }
  
  return deadFuncs;
}

async function validate(counter: number, doc: vscode.TextDocument, solidityDiagnostics: vscode.DiagnosticCollection): Promise<void> {
  if (validationCounter === counter) {
    try {
      const diagnostics: vscode.Diagnostic[] = [];

      const user = await getApplicationUser();
      const config = getConfig() || {};
      const options = { config };
      let srcArr = [[doc.uri.path, doc.getText()]];
      const folders = vscode.workspace.workspaceFolders || [];
      if (folders.length > 0) {
        const serverPath: string = vscode.workspace.getConfiguration().get('strato-vscode.serverPath') || '';
        const currentFolder = folders[0]
		    const folder = currentFolder.uri.path;
        // eslint-disable-next-line import/no-mutable-exports
        const dirPath = `${folder}/${serverPath}`
        srcArr = await importer.combine(doc.uri.path, false, dirPath);
      }
      // Run dead code detector
      const deadCodeArr = await findDeadCode(srcArr);
      
      
      const annotations = await rest.debugPostAnalyze(user, srcArr, options);

      // Push dead code detector annotations in
      for(let i = 0; i < deadCodeArr.length; ++i) {
        annotations.push(deadCodeArr[i]);
      }

      

      for (let ann in annotations) {
        const mDiag = createDiagnostic(doc, annotations[ann]);
        if (mDiag) {
          diagnostics.push(mDiag);
        }
      }

      solidityDiagnostics.set(doc.uri, diagnostics);
    } catch (e) {
      console.log(`validate exception: ${JSON.stringify(e)}`);
    }
  }
}

function createDiagnostic(doc: vscode.TextDocument, ann: any): vscode.Diagnostic | undefined {
  const { start, end } = ann;
  let showAnn = false;
  let sLine = 0;
  let sCol = 0;
  let eLine = 0;
  let eCol = 0;
  if (doc.uri.path.endsWith(start.name)) {
    showAnn = true;
    sLine = start.line && start.line > 0 ? start.line - 1 : 0;
    sCol = start.column && start.column > 0 ? start.column - 1 : 0;
  }
  if (doc.uri.path.endsWith(start.name)) {
    showAnn = true;
    eLine = end.line && end.line > 0 ? end.line - 1 : 0;
    eCol = end.column && end.column > 0 ? end.column - 1 : 0;
  }

  if (showAnn) {
    // create range that represents, where in the document the word is
    const range = new vscode.Range(sLine, sCol, eLine, eCol);

    const diagnostic = new vscode.Diagnostic(range, ann.annotation,
      vscode.DiagnosticSeverity.Warning);
    diagnostic.code = '';
    return diagnostic;
  }
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