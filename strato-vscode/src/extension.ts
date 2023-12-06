// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ContractsProvider } from './contracts';
import { CirrusProvider } from './cirrus';
import { NodesProvider } from './nodes';
import { activateStratoDebug } from './activateStratoDebug';
import { subscribeToDocumentChanges } from './diagnostics';
import { rest, importer } from 'blockapps-rest';
import { getApplicationUser, applicationUserLogin } from './auth';
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
	vscode.commands.registerCommand('extension.oauthLogin', async () => {
		const config = getConfig() || {}
		const nodes = config.nodes || []
		if (nodes.length === 0) {
			vscode.window.showWarningMessage('Please add STRATO node information to your config file.')
			return undefined 
		}
		
		// Take a user and password through input boxes
		const user = await vscode.window.showInputBox({
			prompt: `Enter your STRATO Mercata username`
		});
		if (!user) return;
		const password = await vscode.window.showInputBox({
			prompt: `Enter your password`,
			password: true
		});
		if (!password) return;

		applicationUserLogin(context, user, password)
    });

	// Uploads a contract to the targetted node
	vscode.commands.registerCommand('contracts.uploadContract', async (element) => {
		const { nodeId, item } = element;
		const { chainId } = item;
		const tokens = await getAccessTokenSecrets(context);
		const user = await getApplicationUser(nodeId, tokens);
		const config = getConfig() || {};
		const nodeOptions = { config, node: nodeId };
		if (vscode.window.activeTextEditor) {
			const doc = vscode.window.activeTextEditor.document;
			if (doc.uri.path.slice(-4) === '.sol') {
				let src: any = doc.getText();
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
					vscode.window.showInformationMessage(`Contract ${contractName} created at address: ${res.address}`);
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


	// Calls a function on an existing smart contract
	vscode.commands.registerCommand('contracts.callFunction', async (element) => {
		const { nodeId, item } = element;
		const { chainId, contractName, contractAddress, variableName } = item;
		const tokens = await getAccessTokenSecrets(context);
		const user = await getApplicationUser(nodeId, tokens);
		const config = getConfig() || {}
		const nodeOptions = { config, node: nodeId };
		const val = await rest.getContractsContract(user, contractName, contractAddress, chainId, nodeOptions);
		const { xabi } = val;
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
				const res = await rest.call(user, callArgs, nodeOptions);
				vscode.window.showInformationMessage(`${res}`);
			} catch (e) {
				vscode.window.showErrorMessage(`${e}`);
			}
		} else {
			vscode.window.showErrorMessage(`Could not find a function called ${variableName} in ${contractName} at address ${contractAddress} on chain ${chainId} on node ${nodeId}.`);
		}
	});


	// Register the contracts provider for the sidebar
	const contractsProvider = new ContractsProvider();
	vscode.commands.registerCommand('contracts.refreshEntry', async () => contractsProvider.refresh());
	vscode.commands.registerCommand('contracts.searchContract', async () => {
		const argInput = await vscode.window.showInputBox({
			placeHolder: 'ex: Certificate',
			prompt: `Search for a contract by name`
		});
		if (!argInput) return;
		contractsProvider.searchContracts(argInput);
	})
	vscode.window.registerTreeDataProvider('contracts', contractsProvider)

	// Register the Cirrus provider
	const cirrusProvider = new CirrusProvider();
	vscode.commands.registerCommand('cirrus.queryCirrus', async () => {
		const argInput = await vscode.window.showInputBox({
			placeHolder: 'ex: Certificate?address=eq.0000000000000000000000000000000000001337',
			prompt: `Enter cirrus query`
		});
		if (!argInput) return;
		cirrusProvider.query(argInput);
	});
	vscode.window.registerTreeDataProvider('cirrus', cirrusProvider)

	// Register the nodes provider
	const nodesProvider = new NodesProvider();
	vscode.commands.registerCommand('nodes.addConfig', async () => {
		let fp = vscode.workspace.getConfiguration().get('strato-vscode.configPath', '');
		const options: vscode.OpenDialogOptions = {
			title: 'Import configuration',
			openLabel: 'Import configuration',
			canSelectMany: false,
			canSelectFiles: true,
			canSelectFolders: false
		};
		const userSelect = await vscode.window.showOpenDialog(options) || '';
		console.debug(`refreshEntry/userSelect: ${userSelect}`)

		fp = userSelect && userSelect[0] ? userSelect[0].fsPath : ''
		if (!fp.endsWith('.yaml') && !fp.endsWith('.yml')) { 
			vscode.window.showErrorMessage('Please select a valid YAML file.')
			return
		}
		await vscode.workspace.getConfiguration().update('strato-vscode.configPath', fp, true)
		nodesProvider.refresh()
	})
	
	// Open the STRATO settings page
	vscode.commands.registerCommand('nodes.settings', async () => {
		// Open the user settings file
		vscode.commands.executeCommand('workbench.action.openSettings', 'strato-vscode');
	});

	vscode.window.registerTreeDataProvider('nodes', nodesProvider)

	// Register clipboard copier
	vscode.commands.registerCommand('extension.copyToClipboard', async (element) => {
		const { tooltip } = element
		console.debug(`copyToClipboard/element: ${element}`)
		console.debug(`copyToClipboard/tooltip: ${tooltip}`)
		copyToClipboard(tooltip)
	})

	// Activate debug mode and diagnostics
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

// Helper function for listing subdirectories of a folder
function getSubdirectories(rootPath: string): string[] {
	const files = fs.readdirSync(rootPath);
	const subdirectories: string[] = [];

	files.forEach(file => {
		const filePath = path.join(rootPath, file);
		const stats = fs.statSync(filePath);

		if (stats.isDirectory()) {
			subdirectories.push(filePath);
		}
	});

	return subdirectories;
}


// Helper function for running a command in a VS terminal
function runCommand(cmd: string) {
	// Open up a terminal if there aren't any and run the cmd string
	let terminal
	const terminals = vscode.window.terminals;
	if (terminals && terminals.length) {
		terminal = terminals[0]
	} else {
		terminal = vscode.window.createTerminal()
	}
	terminal.show()
	terminal.sendText(cmd, true)
}


// Helper function for copying data to user clipboard
export function copyToClipboard(t: string) {
	vscode.env.clipboard.writeText(t)
		.then(() => { vscode.window.showInformationMessage('Copied to clipboard') })
}

// Get a valid access token
async function getAccessTokenSecrets(context: vscode.ExtensionContext) {
	const secrets = await context.secrets.get('access_token_data')
	return JSON.parse(secrets || '{}')
}
