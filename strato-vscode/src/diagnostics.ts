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
  console.log('IN REFRESHDIAGNOSTICS');
  
  if (doc.uri.path.slice(-4) === '.sol') {
    validationCounter = (validationCounter + 1) % 10000;
    const thisCounter = validationCounter;
    setTimeout(async () => await validate(thisCounter, doc, solidityDiagnostics), 1500);
  }
}

async function findDeadCode(doc: string): Promise<void> {
  console.log('IN FINDDEADCODE');
  
  const user = await getApplicationUser();
  const config = getConfig() || {};
  const options = { config };
  if(typeof doc == 'string'){
    console.log('TRUEE', user);
    
  }
  console.log('CALLING DEBUGPOSTPARSE');
  const contractAST = await rest.debugPostParse(user, doc, options);
  console.log('HERE IS CONTRACTAST', contractAST);
  
  let privFuncs = Array();
  let searchFuncs = Array();
  let deadFuncs = Array();

  // Go through all contracts in file one by one (in case there are multiple)
  for(let contractName in contractAST._contracts) {

    const contractFunctions = contractAST._contracts[contractName]._functions;                  //Save JSON object containing functions of a contract

    for (let key in contractFunctions) {
      searchFuncs.push(contractAST._contracts[contractName]._functions[key].funcContents);    //Save functions from JSON to an array.
      if(contractFunctions[key].funcVisibility != 'Public') {                                 // Distinguish which functions are not Public
        privFuncs.push(key)
      }
    }

    // Search through all functions in the contract to see if it used or if it is dead code
    for(let i = 0; i < privFuncs.length; ++i) {
      for(let j = 0; j < searchFuncs.length; ++j) {
        if(searchFuncs[j].length != 0) {
          // console.log('This array is not empty', searchFuncs[j]);
          for(let k = 0; k < searchFuncs[j].length; ++k) {
            // console.log('Contents of not empty array', searchFuncs[j][k].contents);
            // console.log('Contents of Contents', searchFuncs[j][k].contents[0].contents);
            if(searchFuncs[j][k].contents[0].contents.tag === 'FunctionCall') {
              // If the private function is used, it is not dead code. Remove from array.
              if(searchFuncs[j][k].contents[0].contents.contents[0].contents == privFuncs[i]) {
                // console.log('State of privFuncs before removing position', i);
                // console.log(privFuncs);
                privFuncs.splice(i,1);
                // console.log('AFTER REMOVAL', privFuncs);
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
          deadFuncs.push({'contract': contractName, 'deadFunction': privFuncs[i]})
        }
      }
    }
    // Reset arrays for the next contract
    privFuncs = [];
    searchFuncs = [];
  }
  console.log('List of dead code', deadFuncs);
}

async function validate(counter: number, doc: vscode.TextDocument, solidityDiagnostics: vscode.DiagnosticCollection): Promise<void> {
  console.log('IN VALIDATE');
  console.log('Here is validationCounter', validationCounter);
  console.log('Here is counter', counter);
  
  
  if (validationCounter === counter) {
    try {
      const diagnostics: vscode.Diagnostic[] = [];

      const user = await getApplicationUser();
      const config = getConfig() || {};
      const options = { config };
      console.log('HERE IS REST', rest);
      

      console.log('HERE IS DOC.GETTEXT', doc.getText() );
      findDeadCode(doc.getText());
      
      const annotations = await rest.debugPostAnalyze(user, [[doc.uri.path, doc.getText()]], options);
      console.log('Here are annotations', annotations);
      

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
  console.log('IN CREATEDIAGNOSTIC');
  
  const { start, end } = ann;

  // create range that represents, where in the document the word is
  const range = new vscode.Range(start.line - 1, start.column - 1, end.line - 1, end.column - 1);

  const diagnostic = new vscode.Diagnostic(range, ann.annotation,
    vscode.DiagnosticSeverity.Warning);
  diagnostic.code = '';
  return diagnostic;
}

export async function subscribeToDocumentChanges(context: vscode.ExtensionContext, solidityDiagnostics: vscode.DiagnosticCollection): Promise<void> {
  console.log('IN SUBSCRIBETODOCUMENTCHANGES');
  
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