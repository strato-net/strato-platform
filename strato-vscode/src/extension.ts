// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import { ContractsProvider } from './contracts';
import { DeploymentsProvider } from './deployments';
import { NodesProvider } from './nodes';
import { ProjectActionProvider } from './project';
import { activateStratoDebug } from './activateStratoDebug';
import { subscribeToDocumentChanges } from './diagnostics';

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
		fs.readFile(process.cwd() + '/resources/testupload.sh', 'utf8', function (err, data) {
			if (err) {
				return console.log(err);
			}
			let result = data.replace(/\[TEST_NODE\]/g, testInput || '[TEST_NODE]')
				.replace(/\[PROD_NODE\]/g, prodInput || '[PROD_NODE]');

			// fs.writeFile(process.cwd()+'/resources/testupload.sh', result, 'utf8', function(err){
			// 	if (err) return console.log(err);
			// })
			fs.writeFile(workspaceFolderUri.path + '/testupload.sh', result, 'utf8', function (err) {
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
	vscode.window.registerTreeDataProvider(
		'contracts',
		contractsProvider
	)
	const deploymentsProvider = new DeploymentsProvider();
	vscode.window.registerTreeDataProvider('deployments', deploymentsProvider);
	vscode.commands.registerCommand('deployments.refreshEntry', () =>
		deploymentsProvider.refresh()
	);
	vscode.window.registerTreeDataProvider(
		'deployments',
		deploymentsProvider
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
