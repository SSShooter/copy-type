// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// 存储当前悬浮位置的类型信息
let currentTypeInfo: string | null = null;
let currentPosition: vscode.Position | null = null;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "copy-type" is now active!');

	// 注册hover provider
	const hoverProvider = vscode.languages.registerHoverProvider(
		['typescript', 'typescriptreact', 'vue'],
		{
			provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
				// 获取TypeScript语言服务
				return getTypeAtPosition(document, position).then(typeInfo => {
					if (typeInfo) {
						// 存储当前类型信息和位置
						currentTypeInfo = typeInfo;
						currentPosition = position;
						
						// 创建hover内容
						const hoverContent = new vscode.MarkdownString();
						hoverContent.appendCodeblock(typeInfo, 'typescript');
						hoverContent.appendMarkdown('\n\n**Press Ctrl+Shift+C (Cmd+Shift+C on Mac) to copy this type**');
						
						return new vscode.Hover(hoverContent);
					}
					return null;
				});
			}
		}
	);

	// 注册复制类型命令
	const copyTypeCommand = vscode.commands.registerCommand('copy-type.copyTypeAtCursor', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('No active editor found');
			return;
		}

		const document = editor.document;
		const position = editor.selection.active;

		// 如果当前位置有缓存的类型信息，直接使用
		if (currentTypeInfo && currentPosition && 
			currentPosition.line === position.line && 
			Math.abs(currentPosition.character - position.character) < 10) {
			
			await vscode.env.clipboard.writeText(currentTypeInfo);
			vscode.window.showInformationMessage(`Type copied to clipboard: ${currentTypeInfo}`);
			return;
		}

		// 否则重新获取类型信息
		const typeInfo = await getTypeAtPosition(document, position);
		if (typeInfo) {
			await vscode.env.clipboard.writeText(typeInfo);
			vscode.window.showInformationMessage(`Type copied to clipboard: ${typeInfo}`);
		} else {
			vscode.window.showWarningMessage('No type information found at cursor position');
		}
	});

	context.subscriptions.push(hoverProvider, copyTypeCommand);
}

// 获取指定位置的类型信息
async function getTypeAtPosition(document: vscode.TextDocument, position: vscode.Position): Promise<string | null> {
	try {
		// 使用VS Code的TypeScript语言服务
		const uri = document.uri;
		
		// 执行TypeScript的quickinfo命令获取类型信息
		const quickInfo = await vscode.commands.executeCommand<any>(
			'vscode.executeHoverProvider',
			uri,
			position
		);

		if (quickInfo && quickInfo.length > 0) {
			const hover = quickInfo[0];
			if (hover.contents && hover.contents.length > 0) {
				// 提取类型信息
				for (const content of hover.contents) {
					if (typeof content === 'object' && content.value) {
						// 查找包含类型信息的代码块
						const match = content.value.match(/```typescript\n([\s\S]*?)\n```/);
						if (match && match[1]) {
							// 清理类型信息，移除变量名，只保留类型
							const typeStr = match[1].trim();
							// 尝试提取类型部分（去掉变量名）
							const typeMatch = typeStr.match(/:\s*(.+)$/);
							if (typeMatch && typeMatch[1]) {
								return typeMatch[1].trim();
							}
							return typeStr;
						}
					}
				}
			}
		}

		// 备用方案：使用TypeScript语言服务的定义信息
		const definitions = await vscode.commands.executeCommand<vscode.LocationLink[]>(
			'vscode.executeDefinitionProvider',
			uri,
			position
		);

		if (definitions && definitions.length > 0) {
			// 获取符号信息
			const wordRange = document.getWordRangeAtPosition(position);
			if (wordRange) {
				const word = document.getText(wordRange);
				// 这里可以根据需要进一步处理类型信息
				return `${word} (type information available)`;
			}
		}

		return null;
	} catch (error) {
		console.error('Error getting type information:', error);
		return null;
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	// 清理缓存
	currentTypeInfo = null;
	currentPosition = null;
}
