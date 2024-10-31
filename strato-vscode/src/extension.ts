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
import getOptions from './load.options';

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
			prompt: `Enter your STRATO Mercata username.`
		});
		if (!user) return;
		const password = await vscode.window.showInputBox({
			prompt: `Enter your password.`,
			password: true
		});
		if (!password) return;

		applicationUserLogin(context, user, password)
    });

	// Register the contracts provider for the sidebar
	const workspaceAddresses: string[] = context.workspaceState.get('contractAddresses') || []
	const contractsProvider = new ContractsProvider(workspaceAddresses);
	vscode.commands.registerCommand('contracts.refreshEntry', async () => contractsProvider.refresh());

	// Clear contracts list
	vscode.commands.registerCommand('contracts.clearContractList', async () => {
		contractsProvider
			.clearContracts()
			.then(()=> context.workspaceState.update('contractAddresses', []))
	})

	// Clear contracts list
	vscode.commands.registerCommand('contracts.removeContractFromList', async (element) => {
		const { label } = element
		contractsProvider
			.removeContract(label)
			.then(()=> context.workspaceState.update('contractAddresses', []))
		contractsProvider.refresh()
	})

	vscode.commands.registerCommand('contracts.addContractToList', async () => {
		const argInput = await vscode.window.showInputBox({
			placeHolder: 'ex: 1002f61aec1692bd2fa35be14d3b66b074313ed9',
			prompt: `Add contract address to interact with.`
		});
		if (!argInput) return;
		// regex that determines ethereum address
		const addressRegex = /^[0-9a-fA-F]{40}$/;
		// check the argInput for an address
		if (addressRegex.test(argInput)) {
			try {
				const user = await getApplicationUser();
				if (!user) return;
				const options = getOptions() || {}
				// check if the contract exists, err out otherwise
				const res = await rest.getContractsDetails(user, { address: argInput }, options)
				contractsProvider
					.addContract(argInput)
					.then(list => context.workspaceState.update('contractAddresses', list))
				vscode.window.showInformationMessage(`Inserting contract ${res._contractName} from address ${argInput}`);
			} catch (e) {
				vscode.window.showErrorMessage(`Could not get contract details at address ${argInput}`);
			}

		} else {
			vscode.window.showErrorMessage('Please enter a valid Ethereum address.')
		}
	})

	// Uploads a contract to the targetted node
	vscode.commands.registerCommand('contracts.uploadContract', async (element) => {
		const tokens = await getAccessTokenSecrets(context);
		if (Object.keys(tokens).length === 0) { return vscode.window.showErrorMessage('Please log in to STRATO Mercata to upload a contract.') }
		const activeNode: number = await vscode.workspace.getConfiguration().get('strato-vscode.activeNode') || 0;
		const user = await getApplicationUser(activeNode, tokens);
		if (!user) return;
		const nodeOptions = getOptions() || {}
		if (vscode.window.activeTextEditor) {
			vscode.window.activeTextEditor.document.save();
			const doc = vscode.window.activeTextEditor.document;
			if (doc.uri.path.slice(-4) === '.sol') {
				let src: any = doc.getText();
				let srcMap = {}
				const folders = vscode.workspace.workspaceFolders || [];
				if (folders.length > 0) {
					const currentFolder = folders[0]
					const folder = currentFolder.uri.path;
					// eslint-disable-next-line import/no-mutable-exports
					const dirPath = folder + '/'
					srcMap = await importer.combine(doc.uri.path, true, dirPath);
					srcMap[importer.getShortName(doc.uri.path)] = doc.getText();
					src = Object.values(srcMap).reduce((str, fileContents) => `${str}\n${fileContents}`, '');
				}
				try {
					const { src: xabis } = await rest.postContractsXabi(user, { src }, nodeOptions);
					const xabiKeys = Object.keys(xabis);
					const items = xabiKeys.map((x) => ({ label: x }))
					const quickPickOption = items.length === 1 ? items[0] : await vscode.window.showQuickPick(items, {
						placeHolder: 'Pick a contract to upload',
					});
					if (!quickPickOption) return;
					const contractName = quickPickOption ? quickPickOption.label : xabiKeys[0] || '';
					const govXabi = xabis[contractName] || {};
					let args = {}
					if (govXabi.constr) {
						const constr = govXabi.constr;
						const argNames = Object.keys(constr.args || {}).sort((a,b) => constr.args[a].index - constr.args[b].index);
						for (let i = 0; i < argNames.length; i++) {
							const argInput = await vscode.window.showInputBox({
								placeHolder: '',
								prompt: 
									constr.args[argNames[i]].tag === 'Array' ?
									`Enter a value from ${argNames[i]} with comma-separated values`:
									`Enter a value for ${argNames[i]}.`
							});
							if (!argInput && constr.args[argNames[i]].tag != 'Array') return;
							args = { 
								...args,
								[argNames[i]]: coerceType(constr.args[argNames[i]], argInput || "")
							}
						}
					}
					const uploadArgs = {
						source: await importer.combine(doc.uri.path),
						args,
						name: contractName,
						chainid: null,
					}
					const res = await rest.createContract(user, uploadArgs, nodeOptions);
					vscode.window.showInformationMessage(`Contract ${contractName} created at address: ${res.address}`);
					contractsProvider
						.addContract(res.address)
						.then(list => context.workspaceState.update('contractAddresses', list))
				} catch (e: any) {
					vscode.window.showErrorMessage(`${e.response.data|| e}`);
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
		if (Object.keys(tokens).length === 0) { return vscode.window.showErrorMessage('Please log in to STRATO Mercata to upload a contract.') }
		const activeNode: number = await vscode.workspace.getConfiguration().get('strato-vscode.activeNode') || 0;
		const user = await getApplicationUser(activeNode, tokens);
		if (!user) return;
		const nodeOptions = getOptions() || {}
		const val = await rest.getContractsContract(user, contractName, contractAddress, chainId, nodeOptions);
		const func = ((val || {})._functions || {})[variableName]
		if (variableName && variableName !== 'constructor' && func) {
			const argNames = func._funcArgs || []
			let args = {}
			for (let i = 0; i < argNames.length; i++) {
				const argInput = await vscode.window.showInputBox({
					placeHolder: '',
					prompt: argNames[i][1].type.tag === 'Array' ?
							`Enter a value for ${argNames[i][0]} with comma-separated values`:
							`Enter a value for ${argNames[i][0]}.`
				});
				if (!argInput && argNames[i][1].type.tag != 'Array') return;
				args[argNames[i][0]] = coerceType(argNames[i][1].type, argInput || '')
			}
			try {
				const contract = { name: contractName, address: contractAddress }
				const callArgs = {
					contract,
					args,
					method: variableName,
				}
				const res = await rest.call(user, callArgs, nodeOptions);
				vscode.window.showInformationMessage(`Successfully called function ${variableName} on ${contractName} at address ${contractAddress}`);
				contractsProvider.refresh()
			} catch (e: any) {
				vscode.window.showErrorMessage(`${e}`);
			}
		} else {
			vscode.window.showErrorMessage(`Could not find a function called ${variableName} in ${contractName} at address ${contractAddress} on chain ${chainId} on node ${nodeId}.`);
		}
	});
	vscode.window.registerTreeDataProvider('contracts', contractsProvider)

	// Register the Cirrus provider
	const cirrusProvider = new CirrusProvider();
	vscode.commands.registerCommand('cirrus.queryCirrus', async () => {
		const argInput = await vscode.window.showInputBox({
			placeHolder: 'ex: BlockApps-Mercata-Asset?address=eq.9b617d82a19cde1a5ad3489bfb91716c88f928a6',
			prompt: `Enter cirrus query.`
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
		await vscode.workspace.getConfiguration().update('strato-vscode.activeNode', 0, true)
		await vscode.workspace.getConfiguration().update('strato-vscode.configPath', fp, true)
		nodesProvider.refresh()
	})
	
	// Open the STRATO settings page
	vscode.commands.registerCommand('nodes.settings', async () => {
		// Open the user settings file
		vscode.commands.executeCommand('workbench.action.openSettings', 'strato-vscode');
	});

	vscode.commands.registerCommand('nodes.refresh', async () => {
		nodesProvider.refresh()
	});

	vscode.commands.registerCommand('nodes.setActiveNode', async (element) => {
		const id = element.node.id
		await vscode.workspace.getConfiguration().update('strato-vscode.activeNode', id, true)
		nodesProvider.refresh()
		contractsProvider.refresh()
		vscode.window.showInformationMessage(`Set active node to ${element.tooltip}.`)
	})
	
	vscode.window.registerTreeDataProvider('nodes', nodesProvider)

	// Register clipboard copier
	vscode.commands.registerCommand('extension.copyLabelToClipboard', async (element) => {
		const { label } = element
		copyToClipboard(label)
	})

	vscode.commands.registerCommand('extension.copyTooltipToClipboard', async (element) => {
		const { tooltip } = element
		copyToClipboard(tooltip)
	})

	vscode.commands.registerCommand('extension.provideSampleConfiguration', async () => {
		const sampleConfig =
/**
 * Bare minimum configuration to get the VS Code extension features running
 * 
 * TODO: make SolidVM the default VM in the API so "VM: SolidVM" can be removed
 */
`# STRATO VS Code Extension Node Configuration

nodes:
  - id: 0
    label: node1 # Call this node whatever you like
    url: <nodeURL>
    oauth:
      openIdDiscoveryUrl: >-
        <openIdURL>/.well-known/openid-configuration
      clientId: <clientId>
      clientSecret: <clientSecret>
      # scope: <optional>

# You can have more than one node
# - id: 1
#	  label: ...
#	  url: ...`
		// open this file in the editor
		const doc = await vscode.workspace.openTextDocument({ content: sampleConfig, language: 'yaml' });
		await vscode.window.showTextDocument(doc);
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

function coerceType(argument: any, input: string) {
	switch(argument.tag) {
		case "Array": return input.split(',').map(c => {return coerceType(argument.entry, c)}) 
		case "Int": return parseInt(input)
		case "Contract": return parseInt(input)
		case "UnknownLabel": return parseInt(input) // Enums are accessed through one-based indexing
		case "Address": return input
		case "String": return input
		default: return input
	}
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
