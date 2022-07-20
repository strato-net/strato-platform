// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ContractsProvider } from './contracts';
import { CirrusProvider } from './cirrus';
import { NodesProvider } from './nodes';
import { ProjectActionProvider } from './project';
import { activateStratoDebug } from './activateStratoDebug';
import { subscribeToDocumentChanges } from './diagnostics';
import { rest, importer } from 'blockapps-rest';
import { getApplicationUser } from './auth';
import getConfig from './load.config';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "strato-vscode" is now active!');
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.createProject', async () => {
		const testInput = await vscode.window.showInputBox({
			ignoreFocusOut: true, placeHolder: 'E.g. http://test-node.blockapps.net:8080',
			prompt: 'URL to STRATO Test Node'
		});

		const prodInput = await vscode.window.showInputBox({
			ignoreFocusOut: true,
			placeHolder: 'E.g. http://production-node.blockapps.net:8080',
			prompt: 'URL to STRATO Production Node'
		});

		const options: vscode.OpenDialogOptions = {
			canSelectMany: false,
			openLabel: 'Select',
			canSelectFiles: false,
			canSelectFolders: true
		};

		const folderUri = await vscode.window.showOpenDialog(options);
		if (folderUri && folderUri[0]) {
			console.log('Selected folder: ' + folderUri[0].fsPath);
		}
		const projectName = (folderUri || [])[0].fsPath || '';
		const workspaceFolderUri = vscode.Uri.parse(projectName);
		const cmd: string = vscode.workspace.getConfiguration().get('strato-vscode.createProjectCommand') || '';
		const cmdStr = cmd.replace(/\$1/g, workspaceFolderUri.path);
		let terminal
		const terminals = vscode.window.terminals;
		if (terminals && terminals.length) {
			terminal = terminals[0]
		} else {
			terminal = vscode.window.createTerminal()
		}
		terminal.show()
		terminal.sendText(cmdStr, true)
		const numFolders = (vscode.workspace.workspaceFolders || []).length;
		vscode.workspace.updateWorkspaceFolders(0, numFolders, { uri: workspaceFolderUri });
		await sleep(500);
		fs.readFile(path.resolve(path.join(process.cwd(), 'resources', 'testupload.sh')).replace('C:\\c:\\','C:\\').replace('C:\\C:\\','C:\\'), 'utf8', function (err, data) {
			if (err) {
				return console.log(err);
			}
			let result = data.replace(/\[TEST_NODE\]/g, testInput || '[TEST_NODE]')
				.replace(/\[PROD_NODE\]/g, prodInput || '[PROD_NODE]');

			// fs.writeFile(process.cwd()+'/resources/testupload.sh', result, 'utf8', function(err){
			// 	if (err) return console.log(err);
			// })
			fs.writeFile(path.resolve(path.join(workspaceFolderUri.path, 'testupload.sh')).replace('C:\\c:\\','C:\\').replace('C:\\C:\\','C:\\'), result, 'utf8', function (err) {
				if (err) return console.log(err);
			})
		})
	}));
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.deployProject', () => {
		const cmd: string = vscode.workspace.getConfiguration().get('strato-vscode.deployProjectCommand') || '';
		const terminals = vscode.window.terminals;
		if (terminals && terminals.length) {
			const terminal = terminals[0]
			terminal.show()
			terminal.sendText(cmd, true)
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.runServer', () => {
		const cmd: string = vscode.workspace.getConfiguration().get('strato-vscode.runServerCommand') || '';
		const terminals = vscode.window.terminals;
		if (terminals && terminals.length) {
			const terminal = terminals[0]
			terminal.show()
			terminal.sendText(cmd, true)
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.testServer', () => {
		const cmd: string = vscode.workspace.getConfiguration().get('strato-vscode.testServerCommand') || '';
		const terminals = vscode.window.terminals;
		if (terminals && terminals.length) {
			const terminal = terminals[0]
			terminal.show()
			terminal.sendText(cmd, true)
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.runUI', () => {
		const cmd: string = vscode.workspace.getConfiguration().get('strato-vscode.runUICommand') || '';
		const terminals = vscode.window.terminals;
		if (terminals && terminals.length) {
			const terminal = terminals[0]
			terminal.show()
			terminal.sendText(cmd, true)
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.testUI', () => {
		const cmd: string = vscode.workspace.getConfiguration().get('strato-vscode.testUICommand') || '';
		const terminals = vscode.window.terminals;
		if (terminals && terminals.length) {
			const terminal = terminals[0]
			terminal.show()
			terminal.sendText(cmd, true)
		}
	}));

	const contractsProvider = new ContractsProvider();
	vscode.window.registerTreeDataProvider('contracts', contractsProvider);
	vscode.commands.registerCommand('contracts.refreshEntry', () =>
		contractsProvider.refresh()
	);
	vscode.commands.registerCommand('contracts.createChain', async (element) => {
		const { nodeId } = element;
    const user = await getApplicationUser(nodeId);
    const config = getConfig() || {};
		const nodeOptions = { config, node: nodeId };
    const userAddress = await rest.getKey(user, nodeOptions);
		if (vscode.window.activeTextEditor) {
		  const doc = vscode.window.activeTextEditor.document;
      if (doc.uri.path.slice(-4) === '.sol') {
        let src:any = doc.getText();
  		  let srcMap = {}
        const folders = vscode.workspace.workspaceFolders || [];
        if (folders.length > 0) {
          const serverPath: string = vscode.workspace.getConfiguration().get('strato-vscode.serverPath') || '';
          const currentFolder = folders[0]
  		    const folder = currentFolder.uri.path;
          // eslint-disable-next-line import/no-mutable-exports
          const dirPath = `${folder}/${serverPath}`
          srcMap = await importer.combine(doc.uri.path, true, dirPath);
          srcMap[importer.getShortName(doc.uri.path)] = doc.getText();
  		  	src = Object.values(srcMap).reduce((str, fileContents) => `${str}\n${fileContents}`, '');
        }
  			try {
    		  const chainLabel = await vscode.window.showInputBox({
    		    placeHolder: '',
    		    prompt: `Enter a value for the chain label: `
    		  });
  				if (!chainLabel) return;
          const { src: xabis } = await rest.postContractsXabi(user, { src }, nodeOptions);
    		  const xabiKeys = Object.keys(xabis);
    		  const items = xabiKeys.map((x) => ({ label: x }))
    		  const quickPickOption = await vscode.window.showQuickPick(items, {
    		    placeHolder: 'Pick a contract to use as the chain\'s governance contract',
    		  });
  				if (!quickPickOption) return;
  				const contractName = quickPickOption ? quickPickOption.label : xabiKeys[0] || '';
    		  const govXabi = xabis[contractName] || {};
    		  let args = {}
    		  if (govXabi.constr) {
    		  	const constr = govXabi.constr;
    		  	const argNames = Object.keys(constr.args || {});
    		  	for (let i = 0; i < argNames.length; i++) {
    		      const argInput = await vscode.window.showInputBox({
    		        placeHolder: '',
    		        prompt: `Enter a value for ${argNames[i]}: `
    		      });
  				    if (!argInput) return;
    		  		args = { ...args, [argNames[i]]: argInput }
    		  	}
    		  }
          const chainArgs = {
  		    	label: chainLabel,
  		    	src: srcMap,
  		    	args,
  		    	members: [{"address": userAddress, "enode": "enode://abcd@1.2.3.4:30303"}],
  		    	balances: [{"address": userAddress, "balance": 100000000000000}],
  		    }
  				const contract = { name: contractName }
  		    const res = await rest.createChain(user, chainArgs, contract, nodeOptions);
  		    vscode.window.showInformationMessage(`${res}`);
			  } catch (e) {
  	  	  vscode.window.showErrorMessage(`${e}`);
				}
			} else {
  		  vscode.window.showErrorMessage(`Please open a Solidity file to begin creating a private chain.`);
			}
		} else {
  		vscode.window.showErrorMessage(`No active text editor found. Please open a Solidity file.`);
		}
	});
	vscode.commands.registerCommand('contracts.uploadContract', async (element) => {
		const { nodeId, item } = element;
		const { chainId } = item;
    const user = await getApplicationUser(nodeId);
    const config = getConfig() || {};
		const nodeOptions = { config, node: nodeId };
		if (vscode.window.activeTextEditor) {
		  const doc = vscode.window.activeTextEditor.document;
      if (doc.uri.path.slice(-4) === '.sol') {
        let src:any = doc.getText();
		    let srcMap = {}
        const folders = vscode.workspace.workspaceFolders || [];
        if (folders.length > 0) {
          const serverPath: string = vscode.workspace.getConfiguration().get('strato-vscode.serverPath') || '';
          const currentFolder = folders[0]
		      const folder = currentFolder.uri.path;
          // eslint-disable-next-line import/no-mutable-exports
          const dirPath = `${folder}/${serverPath}`
          srcMap = await importer.combine(doc.uri.path, true, dirPath);
          srcMap[importer.getShortName(doc.uri.path)] = doc.getText();
		    	src = Object.values(srcMap).reduce((str, fileContents) => `${str}\n${fileContents}`, '');
        }
			  try {
          const { src: xabis } = await rest.postContractsXabi(user, { src }, nodeOptions);
  	  	  const xabiKeys = Object.keys(xabis);
  	  	  const items = xabiKeys.map((x) => ({ label: x }))
  	  	  const quickPickOption = await vscode.window.showQuickPick(items, {
  	  	    placeHolder: 'Pick a contract to upload',
  	  	  });
			  	if (!quickPickOption) return;
			  	const contractName = quickPickOption ? quickPickOption.label : xabiKeys[0] || '';
  	  	  const govXabi = xabis[contractName] || {};
  	  	  let args = {}
  	  	  if (govXabi.constr) {
  	  	  	const constr = govXabi.constr;
  	  	  	const argNames = Object.keys(constr.args || {});
  	  	  	for (let i = 0; i < argNames.length; i++) {
  	  	      const argInput = await vscode.window.showInputBox({
  	  	        placeHolder: '',
  	  	        prompt: `Enter a value for ${argNames[i]}: `
  	  	      });
			  	    if (!argInput) return;
  	  	  		args = { ...args, [argNames[i]]: argInput }
  	  	  	}
  	  	  }
          const uploadArgs = {
		      	source: srcMap,
		      	args,
			  		name: contractName,
			  		chainid: chainId,
		      }
		      const res = await rest.createContract(user, uploadArgs, nodeOptions);
		      vscode.window.showInformationMessage(`${res}`);
			  } catch (e) {
  	  	  vscode.window.showErrorMessage(`${e}`);
			  }
			} else {
  		  vscode.window.showErrorMessage(`Please open a Solidity file to begin uploading a contract.`);
			}
		} else {
  		vscode.window.showErrorMessage(`No active text editor found. Please open a Solidity file.`);
		}
	});
	vscode.commands.registerCommand('contracts.callFunction', async (element) => {
		const { nodeId, item } = element;
		const { chainId, contractName, contractAddress, variableName } = item;
    const user = await getApplicationUser(nodeId);
    const config = getConfig() || {}
		const nodeOptions = { config, node: nodeId };
    const { xabi } = await rest.getContractsContract(user, contractName, contractAddress, chainId, nodeOptions);
		const func = ((xabi || {}).funcs || {})[variableName]
		if (variableName && variableName !== 'constructor' && func) {
			const argNames = Object.keys(func.args || {});
			let args = {}
			for (let i = 0; i < argNames.length; i++) {
		    const argInput = await vscode.window.showInputBox({
		      placeHolder: '',
		      prompt: `Enter a value for ${argNames[i]}: `
		    });
				if (!argInput) return;
				args = { ...args, [argNames[i]]: argInput }
			}
			try {
			const contract = { name: contractName, address: contractAddress }
      const callArgs = {
				contract,
				args,
				method: variableName,
				chainid: chainId
			}
			const res = await rest.call( user, callArgs, nodeOptions);
			vscode.window.showInformationMessage(`${res}`);
			} catch (e) {
			  vscode.window.showErrorMessage(`${e}`);
			}
		} else {
			vscode.window.showErrorMessage(`Could not find a function called ${variableName} in ${contractName} at address ${contractAddress} on chain ${chainId} on node ${nodeId}.`);
		}
	});
	vscode.window.registerTreeDataProvider(
		'contracts',
		contractsProvider
	)
	const cirrusProvider = new CirrusProvider();
	vscode.window.registerTreeDataProvider('cirrus', cirrusProvider);
	vscode.commands.registerCommand('cirrus.queryCirrus', async () => {
		const argInput = await vscode.window.showInputBox({
		  placeHolder: '',
		  prompt: `Enter cirrus query`
		});
		if (!argInput) return;
		cirrusProvider.query(argInput);
	});
	vscode.window.registerTreeDataProvider(
		'cirrus',
		cirrusProvider
	)
	const nodesProvider = new NodesProvider();
	vscode.window.registerTreeDataProvider('nodes', nodesProvider);
	vscode.commands.registerCommand('nodes.refreshEntry', () =>
		nodesProvider.refresh()
	);
	vscode.window.registerTreeDataProvider(
		'nodes',
		nodesProvider
	)
	vscode.window.registerTreeDataProvider(
		'project-management',
		new ProjectActionProvider()
	)
	activateStratoDebug(context);
	const solidityDiagnostics = vscode.languages.createDiagnosticCollection("solidity");
	context.subscriptions.push(solidityDiagnostics);

	await subscribeToDocumentChanges(context, solidityDiagnostics);
}

async function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}
// this method is called when your extension is deactivated
export function deactivate() { }
