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

	// Imports the project directory into the VS Code workspace context
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.importProject', async () => {
		// Import project directory into workspace
		const options: vscode.OpenDialogOptions = {
			title: 'Import project directory',
			openLabel: 'Import project',
			canSelectMany: false,
			canSelectFiles: false,
			canSelectFolders: true
		};

		const folderUri = await vscode.window.showOpenDialog(options);
		if (folderUri && folderUri[0]) {
			console.debug(`importProject/Selected folder: ${folderUri[0].fsPath}`)

			const projectName = folderUri[0].fsPath
			const workspaceFolderUri = vscode.Uri.parse(projectName);
			const numFolders = (vscode.workspace.workspaceFolders || []).length;
			vscode.workspace.updateWorkspaceFolders(0, numFolders, { uri: workspaceFolderUri });

			context.workspaceState.update('strato-vscode.workspaceDir', projectName)
				.then(() => console.debug(`importProject/set strato-vscode.workspaceDir to ${projectName}`))
			vscode.window.showInformationMessage(`STRATO project succesfully imported to workspace at ${projectName}`)
		}
	}))


	// Set the node endpoint to send queries to
	// context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.setNode', () => {
	// 	const nodeEndpoint = await vscode.window.showInputBox({
	// 		ignoreFocusOut: true,
	// 		placeHolder: 'ex: http://node1-mercata-testnet.blockapps.net/',
	// 		prompt: 'URL to STRATO node'
	// 	})
	// 	console.log(`Set node endpoint to ${nodeEndpoint}`)
	// }))


	// Builds and installs project dependencies
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.buildProject', () => {
		vscode.window.showInformationMessage("Building your dApp...")

		// Show the directory paths in a quickPick dialog
		const folderPath: string = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : ""
		console.debug(`buildProject/folderPath: ${folderPath}`)
		const subDirectories = getSubdirectories(folderPath).map(a => path.basename(a)).filter(b => !b.startsWith('.'))  // Ignore .git, .vscode, etc
		console.debug(`buildProject/subDirectories: ${subDirectories}`)

		// Have the user select the directories where the build scripts
		// are located then install the project dependencies
		let backendDir, frontendDir
		vscode.window.showQuickPick(subDirectories, { placeHolder: 'Select the backend directory', ignoreFocusOut: true })
			.then(sp => {
				if (sp) {
					backendDir = sp
					context.workspaceState.update('strato-vscode.backendDir', backendDir)
						.then(() => console.debug(`buildProject/backendDir: ${backendDir}`))
					runCommand(`cd ${backendDir}; yarn install; cd ..`)
				}
			})
			.then(() => {
				vscode.window.showQuickPick(subDirectories, { placeHolder: 'Select the frontend directory', ignoreFocusOut: true })
				.then(sp => {
					if (sp) {
						frontendDir = sp
						context.workspaceState.update('strato-vscode.frontendDir', frontendDir)
							.then(() => console.debug(`buildProject/frontendDir: ${frontendDir}`))
						runCommand(`cd ${frontendDir}; yarn install; cd ..`)
					}
				})
			})
			.then(() => vscode.window.showInformationMessage("Building your dApp..."))
	}))


	// Deploys the smart contracts to the targetted node using selected deploy scripts
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.deployProject', () => {
		// Check if .env exists
		const folders = vscode.workspace.workspaceFolders || [];
		const cwd = folders[0].uri.path
		const backendDir = context.workspaceState.get('strato-vscode.backendDir') || 'backend'
		const envPath = `${cwd}/${backendDir}/.env`

		if (!fs.existsSync(envPath)) {
			vscode.window.showWarningMessage('.env file does not exist, creating one for you. Consult your project README for additional help.')
			runCommand(`touch ${envPath}`)
			return
		}

		// Runs 'CONFIG=mercata yarn deploy' using backend/package.json
		// TODO(moncayo): should enumerate all the test:<test_case> commands in package.json
		const cmd: string = vscode.workspace.getConfiguration().get('strato-vscode.deployProjectCommand') || '';
		runCommand(`cd ${backendDir}`)
		runCommand(cmd)
		runCommand('cd ..')

		vscode.window.showInformationMessage("Deploying your dApp...")
	}));


	// Runs the project backend server
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.runServer', () => {
		const backendDir = context.workspaceState.get('strato-vscode.backendDir') || 'backend'
		const cmd: string = vscode.workspace.getConfiguration().get('strato-vscode.runServerCommand') || '';
		runCommand(`cd ${backendDir}`)
		runCommand(cmd)
		runCommand('cd ..')
	}));


	// Runs the project UI
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.runUI', () => {
		const frontendDir = context.workspaceState.get('strato-vscode.frontendDir') || 'ui'
		const cmd: string = vscode.workspace.getConfiguration().get('strato-vscode.runUICommand') || '';
		runCommand(`cd ${frontendDir}`)
		runCommand(cmd)
		runCommand('cd ..')
	}));


	// Runs the project tests against the server
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.testServer', () => {
		const backendDir = context.workspaceState.get('strato-vscode.backendDir') || 'backend'
		const cmd: string = vscode.workspace.getConfiguration().get('strato-vscode.testServerCommand') || '';
		runCommand(`cd ${backendDir}`)
		runCommand(cmd)
		runCommand('cd ..')
	}));


	// Runs the project tests against the UI
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.testUI', () => {
		const frontendDir = context.workspaceState.get('strato-vscode.frontendDir') || 'ui'
		const cmd: string = vscode.workspace.getConfiguration().get('strato-vscode.testUICommand') || '';
		runCommand(`cd ${frontendDir}`)
		runCommand(cmd)
		runCommand('cd ..')
	}));


	// Creates a private chain on the targetted node
	vscode.commands.registerCommand('contracts.createChain', async (element) => {
		const { nodeId } = element;
		const user = await getApplicationUser(nodeId);
		const config = getConfig() || {};
		const nodeOptions = { config, node: nodeId };
		const userAddress = await rest.getKey(user, nodeOptions);
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
						members: [{ "address": userAddress, "enode": "enode://abcd@1.2.3.4:30303" }],
						balances: [{ "address": userAddress, "balance": 100000000000000 }],
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


	// Uploads a contract to the targetted node
	vscode.commands.registerCommand('contracts.uploadContract', async (element) => {
		const { nodeId, item } = element;
		const { chainId } = item;
		const user = await getApplicationUser(nodeId);
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


	// Calls a function on an existing smart contract
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
	vscode.window.registerTreeDataProvider('contracts', contractsProvider);
	vscode.commands.registerCommand('contracts.refreshEntry', () =>
		contractsProvider.refresh()
	);
	vscode.window.registerTreeDataProvider(
		'contracts',
		contractsProvider
	)

	// Register the Cirrus provider
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

	// Register the nodes provider
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