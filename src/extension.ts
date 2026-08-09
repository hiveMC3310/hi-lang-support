import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import {
	CloseAction,
	CloseHandlerResult,
	ErrorAction,
	ErrorHandler,
	ErrorHandlerResult,
	Executable,
	LanguageClient,
	Message,
	RevealOutputChannelOn,
} from 'vscode-languageclient/node'

let client: LanguageClient | undefined
let outputChannel: vscode.OutputChannel

// Helper: resolve interpreter path
function findInterpreterPath(
	userPath: string | undefined,
	context: vscode.ExtensionContext,
): string | undefined {
	if (userPath) {
		// If it's a relative path, try to resolve against workspace root
		if (!path.isAbsolute(userPath)) {
			const workspaceFolders = vscode.workspace.workspaceFolders
			if (workspaceFolders) {
				for (const folder of workspaceFolders) {
					const absPath = path.join(folder.uri.fsPath, userPath)
					if (fs.existsSync(absPath)) {
						return absPath
					}
				}
			}
			// Also try relative to extension folder
			const extPath = context.asAbsolutePath(path.join('..', userPath))
			if (fs.existsSync(extPath)) {
				return extPath
			}
		} else {
			// Absolute path
			if (fs.existsSync(userPath)) {
				return userPath
			}
		}
	}

	return userPath || 'hi'
}

// Helper: resolve server path from user setting or auto-detect
function findServerPath(
	userPath: string | undefined,
	context: vscode.ExtensionContext,
): string | undefined {
	// 1. If user provided a path, try to resolve it
	if (userPath) {
		// If it's a relative path, try to resolve against workspace root
		if (!path.isAbsolute(userPath)) {
			const workspaceFolders = vscode.workspace.workspaceFolders
			if (workspaceFolders) {
				for (const folder of workspaceFolders) {
					const absPath = path.join(folder.uri.fsPath, userPath)
					if (fs.existsSync(absPath)) {
						return absPath
					}
				}
			}
			// Also try relative to extension folder
			const extPath = context.asAbsolutePath(path.join('..', userPath))
			if (fs.existsSync(extPath)) {
				return extPath
			}
		} else {
			// Absolute path
			if (fs.existsSync(userPath)) {
				return userPath
			}
		}
		// If not found, fall through to auto-detect
		outputChannel.appendLine(
			`User-provided path "${userPath}" not found, falling back to auto-detection.`,
		)
	}

	// 2. Auto-detect: try PATH (by just using "hi-lsp")
	const pathCandidates = [
		'hi-lsp', // should be in PATH
		context.asAbsolutePath(path.join('..', 'hi-lsp')), // bundled next to extension
	]

	for (const candidate of pathCandidates) {
		if (fs.existsSync(candidate)) {
			return candidate
		}
	}

	return undefined
}

export function activate(context: vscode.ExtensionContext) {
	// Create output channel for logging
	outputChannel = vscode.window.createOutputChannel('Hi LSP')
	context.subscriptions.push(outputChannel)

	const config = vscode.workspace.getConfiguration('hi')
	const userPath = config.get<string>('serverPath')
	outputChannel.appendLine(`User serverPath: ${userPath || '(not set)'}`)

	let serverPath = findServerPath(userPath, context)

	if (!serverPath) {
		vscode.window.showErrorMessage(
			'Hi LSP server not found. Please install hi-lsp in PATH or set "hi.serverPath" to the executable path.',
		)
		outputChannel.appendLine('ERROR: Server not found.')
		return
	}

	outputChannel.appendLine(`Using server: ${serverPath}`)

	const executable: Executable = {
		command: serverPath,
		args: [], // hi-lsp doesn't accept args yet
		options: {
			cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
		},
	}

	const errorHandler: ErrorHandler = {
		error(
			error: Error,
			message: Message | undefined,
			count: number | undefined,
		): ErrorHandlerResult {
			outputChannel.appendLine(`Error: ${error.message}`)
			vscode.window.showErrorMessage(
				`Hi LSP error: ${error.message}. Restarting...`,
			)
			return { action: ErrorAction.Continue }
		},
		closed(): CloseHandlerResult {
			outputChannel.appendLine('Connection closed.')
			vscode.window.showWarningMessage(
				'Hi LSP connection closed. Restarting...',
			)
			return { action: CloseAction.Restart }
		},
	}

	const clientOptions = {
		documentSelector: [{ scheme: 'file', language: 'hi' }],
		synchronize: {
			configurationSection: 'hi',
			fileEvents: vscode.workspace.createFileSystemWatcher('**/*.hi'),
		},
		revealOutputChannelOn: RevealOutputChannelOn.Never,
		outputChannelName: 'Hi Language Server',
		errorHandler,
		// Additional middleware for debugging (optional)
	}

	client = new LanguageClient(
		'hiLanguageServer',
		'Hi Language Server',
		{ run: executable, debug: executable },
		clientOptions,
	)

	// Start the client
	startClient()

	// Register commands
	const restartCommand = vscode.commands.registerCommand(
		'hi.restartServer',
		async () => {
			if (client) {
				// If client is running, stop it first
				if (client.isRunning()) {
					await client.stop()
				}
				// Start fresh
				startClient()
			}
		},
	)
	context.subscriptions.push(restartCommand)

	const runCommand = vscode.commands.registerCommand('hi.runFile', async () => {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			vscode.window.showErrorMessage('No active editor')
			return
		}
		const filePath = editor.document.uri.fsPath
		if (!filePath.endsWith('.hi')) {
			vscode.window.showErrorMessage('Current file is not a Hi script (.hi)')
			return
		}

		// Get interpreter path from settings (absolute or relative)
		const config = vscode.workspace.getConfiguration('hi')
		const userInterpreter = config.get<string>('interpreterPath')
		const interpreter = findInterpreterPath(userInterpreter, context)
		if (!interpreter) {
			vscode.window.showErrorMessage(
				'Hi interpreter not found. Please set "hi.interpreterPath" or ensure "hi" is in PATH.',
			)
			return
		}

		const terminal = vscode.window.createTerminal('Hi Run')
		terminal.sendText(`"${interpreter}" "${filePath}"`)
		terminal.show()
	})
	context.subscriptions.push(runCommand)

	outputChannel.appendLine('Hi extension activated.')
}

function startClient() {
	if (!client) return
	client
		.start()
		.then(() => {
			vscode.window.showInformationMessage('Hi LSP activated!')
			outputChannel.appendLine('Client started successfully.')
		})
		.catch((err) => {
			vscode.window.showErrorMessage(`Failed to start Hi LSP: ${err.message}`)
			outputChannel.appendLine(`Start error: ${err.message}`)
		})
}

export function deactivate() {
	if (client) {
		return client.stop()
	}
}
