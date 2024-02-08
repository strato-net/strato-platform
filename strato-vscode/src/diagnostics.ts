import * as vscode from 'vscode';
import { rest, importer } from 'blockapps-rest';
import getConfig from './load.config';
import getOptions from './load.options';
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

async function findDeadCode(doc: vscode.TextDocument, contractAST: any): Promise<Array<Object>> {  
  let privFuncs = Array();
  let searchFuncs = Array();
  let deadFuncs = Array();

  // Go through all contracts in file one by one (in case there are multiple)
  for(let contractName in contractAST._contracts) {

    const contractFunctions = contractAST._contracts[contractName]._functions;                  //Save JSON object containing functions of a contract

    for (let key in contractFunctions) {      
      searchFuncs.push(contractAST._contracts[contractName]._functions[key].funcContents);    //Save functions from JSON to an array.
      if(contractFunctions[key].funcVisibility === 'Internal') {                                 // Distinguish which functions are not Public
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
            'annotation': {
              '_context': `The function '${privFuncs[i].funcName}' in contract '${contractName}' is never used and should be removed`,
              '_severity': 'Warning'
            },
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

async function findReusedBaseCons(doc: vscode.TextDocument, contractAST: any): Promise<Array<Object>> {

  // Loop through all the contracts and find the ones that don't 
  // have any '_parents' and its constructor doesn't call on 
  // another contract's constructor
  const baseCons = Array();
  for(let contractName in contractAST._contracts) {
    if(contractAST._contracts[contractName]._constructor && Object.keys(contractAST._contracts[contractName]._constructor.funcConstructorCalls).length === 0 && contractAST._contracts[contractName]._parents.length === 0) {
      baseCons.push(contractName);
    }
  }

  const parentChild = Array();
  const contractConstructorLines = Array();
  // Loop through all contracts and find which ones inherit a base constructor
  for(let contractName in contractAST._contracts) {
    // Push the locations of the constructors of each contract into an array
    if (contractAST._contracts[contractName]._constructor) {
      contractConstructorLines.push({
        'contractName': `${contractName}`,
        'start': {
          'column': contractAST._contracts[contractName]._constructor.funcContext.start.column,
          'line': contractAST._contracts[contractName]._constructor.funcContext.start.line,
          'name': contractAST._contracts[contractName]._constructor.funcContext.start.source
        },
        'end': {
          'column': contractAST._contracts[contractName]._constructor.funcContext.end.column,
          'line': contractAST._contracts[contractName]._constructor.funcContext.end.line,
          'name': contractAST._contracts[contractName]._constructor.funcContext.end.source
        }
      });
    }

    for(let baseContractIndex in baseCons) {
      if(contractAST._contracts[contractName] == baseCons[baseContractIndex]) {              // Break loop if contractName matches the name of one of the base constructors
        break;
      }
      for(let parentIndex in contractAST._contracts[contractName]._parents) {       
        if(baseCons[baseContractIndex] === contractAST._contracts[contractName]._parents[parentIndex]) {
          parentChild.push({'parent': contractAST._contracts[contractName]._parents[parentIndex], 'child': contractName});
        }
      }
    }
  }

  let reusedBaseCons = Array();
  // Loop through all contracts and find reused base constructor
  for(let contractName in contractAST._contracts)  {    

    // Check if the contract being looked at is a base contract, if it is, skip it
    let isBaseContract = false
    for(let baseContractIndex in baseCons) {      
      
      if(contractName == baseCons[baseContractIndex]) {
        isBaseContract = true;
        break;
      }
    }
    if(isBaseContract) continue;

    // Check if contract being looked at directly inherits a base contract.
    // If it does, skip it.
    let isChild = false;
    for(let childIndex in parentChild) {
      if(parentChild[childIndex].child === contractName) {
        isChild = true;
        break;
      }
    }
    if(isChild) continue;

    // Check how many contracts are being inherited.
    let inheritedCount = contractAST._contracts[contractName]._parents.length;

    // If only 1 contract is inherited, check if it is a child of a baseContract. 
    // If it is, check if the constructor of contract constructs the base constructor again.
    // If it does, send error message about reused base contracts.
    let foundReusedBaseCont = false;
    if(inheritedCount == 1) {
      for(let parentChildIndex in parentChild) {
        if(parentChild[parentChildIndex].child == contractAST._contracts[contractName]._parents[0]) {
          // The parent of this contract is a child that inherits a base constructor.
          // Check the constructor of this contract to see if it constructs the same base constructor.
          if (contractAST._contracts[contractName]._constructor) {
            for(let key in contractAST._contracts[contractName]._constructor.funcConstructorCalls){
              if(key == parentChild[parentChildIndex].parent){
                foundReusedBaseCont = true;
                let parentConstructorLineNumber;
                // Push annotation for constructor in the parent contract
                for(let i = 0; i < contractConstructorLines.length; ++i) {
                  if(contractConstructorLines[i].contractName === contractAST._contracts[contractName]._parents[0]) {
                    parentConstructorLineNumber = contractConstructorLines[i].start.line
                    reusedBaseCons.push({
                      'annotation': {
                        '_context': `Base constructor arguments given twice for contract '${contractName}' in line ${contractAST._contracts[contractName]._contractContext.start.line}. \nFirst constructor call is in the contract '${contractName}' in line ${contractAST._contracts[contractName]._constructor.funcContext.start.line}. \nSecond constructor call in the contract '${contractAST._contracts[contractName]._parents[0]}' in line ${parentConstructorLineNumber}.`,
                        '_severity': 'Warning'
                      },
                      'start': {
                        'line': contractConstructorLines[i].start.line,
                        'column': contractConstructorLines[i].start.column,
                        'name': contractConstructorLines[i].start.name
                      },
                      'end': {
                        'line': contractConstructorLines[i].end.line,
                        'column': contractConstructorLines[i].end.column,
                        'name': contractConstructorLines[i].end.name
                      }
                    });
                    break;
                  }
                }

                // Push annotation for the line with the contract name
                reusedBaseCons.push({
                  'annotation': {
                    '_context': `Base constructor arguments given twice for contract '${contractName}' in line ${contractAST._contracts[contractName]._contractContext.start.line}. \nFirst constructor call is in the contract '${contractName}' in line ${contractAST._contracts[contractName]._constructor.funcContext.start.line}. \nSecond constructor call in the contract '${contractAST._contracts[contractName]._parents[0]}' in line ${parentConstructorLineNumber}.`,
                    '_severity': 'Warning'
                  },
                  'start': {
                    'line': contractAST._contracts[contractName]._contractContext.start.line,
                    'column': contractAST._contracts[contractName]._contractContext.start.column,
                    'name': contractAST._contracts[contractName]._contractContext.start.name
                  },
                  'end': {
                    'line': contractAST._contracts[contractName]._contractContext.end.line,
                    'column': contractAST._contracts[contractName]._contractContext.end.column,
                    'name': contractAST._contracts[contractName]._contractContext.end.name
                  }
                });

                // Push annotation for constructor of this contract
                reusedBaseCons.push({
                  'annotation': {
                    '_context': `Base constructor arguments given twice for contract '${contractName}' in line ${contractAST._contracts[contractName]._contractContext.start.line}. \nFirst constructor call is in the contract '${contractName}' in line ${contractAST._contracts[contractName]._constructor.funcContext.start.line}. \nSecond constructor call in the contract '${contractAST._contracts[contractName]._parents[0]}' in line ${parentConstructorLineNumber}.`,
                    '_severity': 'Warning'
                  },
                  'start': {
                    'line': contractAST._contracts[contractName]._constructor.funcContext.start.line,
                    'column': contractAST._contracts[contractName]._constructor.funcContext.start.column,
                    'name': contractAST._contracts[contractName]._constructor.funcContext.start.name
                  },
                  'end': {
                    'line': contractAST._contracts[contractName]._constructor.funcContext.end.line,
                    'column': contractAST._contracts[contractName]._constructor.funcContext.end.column,
                    'name': contractAST._contracts[contractName]._constructor.funcContext.end.name
                  }
                });


                break;
              }
            }
          }
        }
        if(foundReusedBaseCont) break;
      }
    }
    if(foundReusedBaseCont) continue;

    // If more than 1 contract is inherited, check if it is a child of a baseContract.
    // If it is, check if the any of the children have the same parent.
    // If they do, send error message about reused base contracts.
    if(inheritedCount > 1) {
      for(let parentChildIndex in parentChild) {
        
        for(let i = parseInt(parentChildIndex)+1; i < parentChild.length; ++i){
          if(parentChild[parentChildIndex].parent === parentChild[i].parent){
            foundReusedBaseCont = true;
            // Push annotation for the contract itself
            const firstStart = contractAST._contracts[parentChild[parentChildIndex].child]._constructor ? contractAST._contracts[parentChild[parentChildIndex].child]._constructor.funcContext.start.line : contractAST._contracts[parentChild[parentChildIndex].child]._contractContext.start.line
            const secondStart = contractAST._contracts[parentChild[i].child]._constructor ? contractAST._contracts[parentChild[i].child]._constructor.funcContext.start.line : contractAST._contracts[parentChild[i].child]._contractContext.start.line
            reusedBaseCons.push({
              'annotation': {
                '_context': `Base constructor arguments given twice for contract '${contractName}' in line ${contractAST._contracts[contractName]._contractContext.start.line}. \nFirst constructor call is in the contract '${parentChild[parentChildIndex].child}' in line ${firstStart}. \nSecond constructor call in the contract '${parentChild[i].child}' in line ${secondStart}.`,
                '_severity': 'Warning'
              },
              'start': {
                'line': contractAST._contracts[contractName]._contractContext.start.line,
                'column': contractAST._contracts[contractName]._contractContext.start.column,
                'name': contractAST._contracts[contractName]._contractContext.start.name
              },
              'end': {
                'line': contractAST._contracts[contractName]._contractContext.end.line,
                'column': contractAST._contracts[contractName]._contractContext.end.column,
                'name': contractAST._contracts[contractName]._contractContext.end.name
              }
            });
            break;
          }
          if(foundReusedBaseCont) break;
        }
        if(foundReusedBaseCont) break;
      }
    }
  }
  return reusedBaseCons;
}

async function validate(counter: number, doc: vscode.TextDocument, solidityDiagnostics: vscode.DiagnosticCollection): Promise<void> {
  if (validationCounter === counter) {
    try {
      const diagnostics: vscode.Diagnostic[] = []; 
      const user = await getApplicationUser();
      const options = getOptions() || {}
      let srcMap = {[doc.uri.path]: doc.getText()};
      const folders = vscode.workspace.workspaceFolders || [];
      if (folders.length > 0) {
        const serverPath: string = vscode.workspace.getConfiguration().get('strato-vscode.serverPath') || '';
        const currentFolder = folders[0]
		    const folder = currentFolder.uri.path;
        // eslint-disable-next-line import/no-mutable-exports
        const dirPath = `${folder}/${serverPath}`
        srcMap = await importer.combine(doc.uri.path, true, dirPath);
        srcMap[importer.getShortName(doc.uri.path)] = doc.getText();
      }

      const contractAST = await rest.debugPostParse(user, srcMap, options);
      const annotations = await rest.debugPostAnalyze(user, srcMap, options);

      // Run dead code detector
      const deadCodeArr = await findDeadCode(doc, contractAST);
      // Push dead code detector annotations in
      for(let i = 0; i < deadCodeArr.length; ++i) {
        annotations.push(deadCodeArr[i]);
      }

      // Run reused base constructor detector
      const reusedBaseCons = await findReusedBaseCons(doc, contractAST);
      for(let i = 0; i < reusedBaseCons.length; ++i) {
        annotations.push(reusedBaseCons[i]);
      }      

      for (let ann in annotations) {
        const mDiag = createDiagnostic(doc, annotations[ann]);
        if (mDiag) {
          diagnostics.push(mDiag);
        }
      }

      solidityDiagnostics.set(doc.uri, diagnostics);

		  const shouldFuzz = vscode.workspace.getConfiguration().get('strato-vscode.autoFuzz') || false;
      if (shouldFuzz) {
        const fuzzAnns = await rest.debugPostFuzz(user, srcMap, options);

        for (let ann in fuzzAnns) {
          const mDiag = createFuzzDiagnostic(doc, fuzzAnns[ann]);
          if (mDiag) {
            diagnostics.push(mDiag);
          }
        }

        solidityDiagnostics.set(doc.uri, diagnostics);
      }
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

    let severity = vscode.DiagnosticSeverity.Information;
    switch (ann.annotation._severity) {
      case 'Error': severity = vscode.DiagnosticSeverity.Error; break;
      case 'Warning': severity = vscode.DiagnosticSeverity.Warning; break;
      case 'Debug': severity = vscode.DiagnosticSeverity.Hint; break;
    }

    const diagnostic = new vscode.Diagnostic(range, ann.annotation._context,
      severity);
    diagnostic.code = '';
    return diagnostic;
  }
}

function createFuzzDiagnostic(doc: vscode.TextDocument, ann: any): vscode.Diagnostic | undefined {
  const { tag } = ann;
  if (tag === 'FuzzerFailure') {
    const { _fuzzerFailureContext={} } = ann;
    const { annotation='' } = _fuzzerFailureContext;
    const withSeverity = { _context: annotation, _severity: 'Error' }
    return createDiagnostic(doc, {  ..._fuzzerFailureContext, annotation: withSeverity });
  } else {
    const { contents={} } = ann;
    const { annotation='' } = contents;
    const withSeverity = { _context: annotation, _severity: 'Debug' }
    return createDiagnostic(doc, { ...contents, annotation: withSeverity });
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
