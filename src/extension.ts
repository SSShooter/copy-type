import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

// TypeScript 语言服务实例
let languageService: ts.LanguageService | null = null;
let program: ts.Program | null = null;
let typeChecker: ts.TypeChecker | null = null;

// 文件缓存
const fileCache = new Map<string, string>();

export function activate(context: vscode.ExtensionContext) {
    console.log('copy-type extension activated');

    // 注册右键菜单命令
    const copyTypeCommand = vscode.commands.registerCommand('copy-type.copyVariableType', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有活动的编辑器');
            return;
        }

        const document = editor.document;
        const selection = editor.selection;
        
        // 获取选中的文本或光标位置的单词
        let selectedText = document.getText(selection);
        let position = selection.active;
        
        if (!selectedText) {
            // 如果没有选中文本，尝试获取光标位置的单词
            const wordRange = document.getWordRangeAtPosition(position);
            if (wordRange) {
                selectedText = document.getText(wordRange);
                position = wordRange.start;
            }
        }

        if (!selectedText) {
            vscode.window.showWarningMessage('请选择一个变量或将光标放在变量上');
            return;
        }

        try {
            const typeInfo = await getVariableType(document, position, selectedText);
            if (typeInfo) {
                await vscode.env.clipboard.writeText(typeInfo);
                vscode.window.showInformationMessage(`类型已复制: ${typeInfo}`);
            } else {
                vscode.window.showWarningMessage(`无法获取变量 "${selectedText}" 的类型信息`);
            }
        } catch (error) {
            console.error('获取类型信息失败:', error);
            vscode.window.showErrorMessage('获取类型信息失败');
        }
    });

    // 注册快捷键命令
    const copyTypeShortcut = vscode.commands.registerCommand('copy-type.copyTypeAtCursor', async () => {
        vscode.commands.executeCommand('copy-type.copyVariableType');
    });

    context.subscriptions.push(copyTypeCommand, copyTypeShortcut);
}

// 获取变量类型
async function getVariableType(document: vscode.TextDocument, position: vscode.Position, variableName: string): Promise<string | null> {
    try {
        // 初始化 TypeScript 服务
        await initializeTypeScriptService(document);
        
        if (!languageService || !typeChecker) {
            return null;
        }

        const fileName = document.uri.fsPath;
        const sourceFile = languageService.getProgram()?.getSourceFile(fileName);
        
        if (!sourceFile) {
            return null;
        }

        // 将 VSCode 位置转换为 TypeScript 位置
        const offset = document.offsetAt(position);
        
        // 查找变量节点
        const node = findNodeAtPosition(sourceFile, offset);
        if (!node) {
            return null;
        }

        // 获取类型信息
        const type = typeChecker.getTypeAtLocation(node);
        if (!type) {
            return null;
        }

        // 格式化类型字符串
        const typeString = typeChecker.typeToString(type, node, ts.TypeFormatFlags.InTypeAlias | ts.TypeFormatFlags.NoTruncation);
        
        return typeString;
    } catch (error) {
        console.error('获取变量类型失败:', error);
        return null;
    }
}

// 初始化 TypeScript 语言服务
async function initializeTypeScriptService(document: vscode.TextDocument): Promise<void> {
    const fileName = document.uri.fsPath;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    
    if (!workspaceFolder) {
        throw new Error('无法找到工作区文件夹');
    }

    const rootPath = workspaceFolder.uri.fsPath;
    
    // 查找 tsconfig.json
    const tsconfigPath = findTsConfig(rootPath);
    let compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        allowJs: true,
        checkJs: false,
        jsx: ts.JsxEmit.React,
        declaration: false,
        outDir: './dist',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true
    };

    // 如果找到 tsconfig.json，读取配置
    if (tsconfigPath) {
        const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
        if (!configFile.error) {
            const parsedConfig = ts.parseJsonConfigFileContent(
                configFile.config,
                ts.sys,
                path.dirname(tsconfigPath)
            );
            compilerOptions = parsedConfig.options;
        }
    }

    // 获取所有 TypeScript/JavaScript 文件
    const files = await getAllTsFiles(rootPath);
    
    // 创建语言服务主机
    const serviceHost: ts.LanguageServiceHost = {
        getScriptFileNames: () => files,
        getScriptVersion: (fileName) => '1',
        getScriptSnapshot: (fileName) => {
            if (!fs.existsSync(fileName)) {
                return undefined;
            }
            
            let content = fileCache.get(fileName);
            if (!content) {
                content = fs.readFileSync(fileName, 'utf8');
                fileCache.set(fileName, content);
            }
            
            return ts.ScriptSnapshot.fromString(content);
        },
        getCurrentDirectory: () => rootPath,
        getCompilationSettings: () => compilerOptions,
        getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
        getDirectories: ts.sys.getDirectories,
    };

    // 创建语言服务
    languageService = ts.createLanguageService(serviceHost, ts.createDocumentRegistry());
    program = languageService.getProgram() || null;
    typeChecker = program?.getTypeChecker() || null;

    // 更新当前文档内容
    fileCache.set(fileName, document.getText());
}

// 查找 tsconfig.json
function findTsConfig(rootPath: string): string | null {
    let currentPath = rootPath;
    
    while (currentPath !== path.dirname(currentPath)) {
        const tsconfigPath = path.join(currentPath, 'tsconfig.json');
        if (fs.existsSync(tsconfigPath)) {
            return tsconfigPath;
        }
        currentPath = path.dirname(currentPath);
    }
    
    return null;
}

// 获取所有 TypeScript/JavaScript 文件
async function getAllTsFiles(rootPath: string): Promise<string[]> {
    const files: string[] = [];
    
    const searchFiles = (dir: string) => {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    // 跳过 node_modules 和其他不需要的目录
                    if (!['node_modules', '.git', 'dist', 'build', '.vscode'].includes(entry.name)) {
                        searchFiles(fullPath);
                    }
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name);
                    if (['.ts', '.tsx', '.js', '.jsx', '.vue'].includes(ext)) {
                        files.push(fullPath);
                    }
                }
            }
        } catch (error) {
            console.error(`读取目录失败: ${dir}`, error);
        }
    };
    
    searchFiles(rootPath);
    return files;
}

// 在指定位置查找节点
function findNodeAtPosition(sourceFile: ts.SourceFile, position: number): ts.Node | null {
    function find(node: ts.Node): ts.Node | null {
        if (position >= node.getStart() && position < node.getEnd()) {
            return ts.forEachChild(node, find) || node;
        }
        return null;
    }
    
    return find(sourceFile);
}

export function deactivate() {
    languageService = null;
    program = null;
    typeChecker = null;
    fileCache.clear();
}
