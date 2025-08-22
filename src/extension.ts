import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

// TypeScript language service instance
let languageService: ts.LanguageService | null = null;
let program: ts.Program | null = null;
let typeChecker: ts.TypeChecker | null = null;

// File cache and service state
const fileCache = new Map<string, string>();
const fileVersions = new Map<string, number>();
let isServiceInitialized = false;
let currentWorkspaceRoot: string | null = null;
let serviceHost: ts.LanguageServiceHost | null = null;

export function activate(context: vscode.ExtensionContext) {
    console.log('copy-type extension activated');

    // Register right-click menu command
    const copyTypeCommand = vscode.commands.registerCommand('copy-type.copyTypeAtCursor', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        const document = editor.document;
        const selection = editor.selection;
        
        // Get selected text or word at cursor position
        let selectedText = document.getText(selection);
        let position = selection.active;

        if (!selectedText) {
            // If no text is selected, try to get the word at cursor position
            const wordRange = document.getWordRangeAtPosition(position);
            if (wordRange) {
                selectedText = document.getText(wordRange);
                position = wordRange.start;
            }
        }

        if (!selectedText) {
            vscode.window.showWarningMessage('Please select a variable or place cursor on a variable');
            return;
        }

        try {
            // Show loading progress
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Getting type information...",
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: "Analyzing code..." });

                const typeInfo = await getVariableType(document, position, selectedText, progress);

                progress.report({ increment: 100, message: "Complete" });

                if (typeInfo) {
                    await vscode.env.clipboard.writeText(typeInfo);
                    vscode.window.showInformationMessage(`Type copied: ${typeInfo}`);
                } else {
                    vscode.window.showWarningMessage(`Unable to get type information for variable "${selectedText}"`);
                }
            });
        } catch (error) {
            console.error('Failed to get type information:', error);
            vscode.window.showErrorMessage('Failed to get type information');
        }
    });

    context.subscriptions.push(copyTypeCommand);
}

// Get variable type
async function getVariableType(
    document: vscode.TextDocument,
    position: vscode.Position,
    variableName: string,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<string | null> {
    try {
        progress?.report({ increment: 10, message: "Checking workspace..." });

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
            return null;
        }

        const rootPath = workspaceFolder.uri.fsPath;

        // Only reinitialize when workspace changes or service is not initialized
        if (!isServiceInitialized || currentWorkspaceRoot !== rootPath) {
            progress?.report({ increment: 20, message: "Initializing TypeScript service..." });
            await initializeTypeScriptService(rootPath);
            currentWorkspaceRoot = rootPath;
            isServiceInitialized = true;
            progress?.report({ increment: 60, message: "Service initialization complete" });
        } else {
            progress?.report({ increment: 50, message: "Using cached service" });
        }

        if (!languageService || !typeChecker) {
            return null;
        }

        progress?.report({ increment: 70, message: "Updating file cache..." });

        const fileName = document.uri.fsPath;

        // Update current document content to cache
        const currentContent = document.getText();
        const cachedContent = fileCache.get(fileName);

        // Only update version when content changes
        if (cachedContent !== currentContent) {
            fileCache.set(fileName, currentContent);
            const currentVersion = fileVersions.get(fileName) || 1;
            fileVersions.set(fileName, currentVersion + 1);
        }

        progress?.report({ increment: 80, message: "Parsing source file..." });

        // Get source file
        const sourceFile = languageService.getProgram()?.getSourceFile(fileName);
        if (!sourceFile) {
            return null;
        }

        // Convert VSCode position to TypeScript position
        const offset = document.offsetAt(position);

        progress?.report({ increment: 90, message: "Analyzing type information..." });

        // Find the most specific node
        const node = findMostSpecificNodeAtPosition(sourceFile, offset);
        if (!node) {
            console.log('No node found at position:', offset);
            return null;
        }

        console.log('Found node:', ts.SyntaxKind[node.kind], 'at position:', offset);
        console.log('Node text:', node.getText(sourceFile));

        // Get type information
        const type = typeChecker.getTypeAtLocation(node);
        if (!type) {
            console.log('No type found for node');
            return null;
        }

        console.log('Type flags:', type.flags);
        console.log('Type symbol:', type.symbol?.name);

        // Try different type formatting options
        let typeString: string;

        // Use flag combination to avoid import() syntax
        const formatFlags =
            ts.TypeFormatFlags.InTypeAlias |
            ts.TypeFormatFlags.NoTruncation |
            ts.TypeFormatFlags.WriteArrayAsGenericType |
            ts.TypeFormatFlags.UseStructuralFallback |
            ts.TypeFormatFlags.WriteTypeArgumentsOfSignature |
            ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

        // For object types, try to get more detailed type information
        if (type.flags & ts.TypeFlags.Object) {
            typeString = typeChecker.typeToString(type, node, formatFlags);
        } else {
            // For other types, use the same formatting options
            typeString = typeChecker.typeToString(type, node, formatFlags);
        }

        console.log('Generated type string:', typeString);

        // If we get 'any', try to infer type from node's context
        if (typeString === 'any' && node.parent) {
            console.log('Got any, trying parent context...');
            const parentType = typeChecker.getTypeAtLocation(node.parent);
            if (parentType && parentType !== type) {
                let parentTypeString = typeChecker.typeToString(
                    parentType,
                    node.parent,
                    formatFlags
                );
                console.log('Parent type string:', parentTypeString);
                if (parentTypeString !== 'any') {
                    typeString = parentTypeString;
                }
            }
        }

        return typeString;
    } catch (error) {
        console.error('Failed to get variable type:', error);
        return null;
    }
}

// Initialize TypeScript language service
async function initializeTypeScriptService(rootPath: string): Promise<void> {
    
    // Find tsconfig.json
    const tsconfigPath = findTsConfig(rootPath);
    let compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Node10,
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

    // If tsconfig.json is found, read configuration
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

    // Get all TypeScript/JavaScript files
    const files = await getAllTsFiles(rootPath);
    
    // Create language service host
    serviceHost = {
        getScriptFileNames: () => files,
        getScriptVersion: (fileName) => {
            const version = fileVersions.get(fileName) || 1;
            return version.toString();
        },
        getScriptSnapshot: (fileName) => {
            if (!fs.existsSync(fileName)) {
                return undefined;
            }

            let content = fileCache.get(fileName);
            if (!content) {
                try {
                    content = fs.readFileSync(fileName, 'utf8');
                    fileCache.set(fileName, content);
                    fileVersions.set(fileName, 1);
                } catch (error) {
                    return undefined;
                }
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

    // Create language service
    languageService = ts.createLanguageService(serviceHost, ts.createDocumentRegistry());
    program = languageService.getProgram() || null;
    typeChecker = program?.getTypeChecker() || null;
}

// Find tsconfig.json
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

// Get all TypeScript/JavaScript files (optimized version)
async function getAllTsFiles(rootPath: string): Promise<string[]> {
    const files: string[] = [];
    const maxDepth = 10; // Limit search depth
    const maxFiles = 1000; // Limit file count

    const searchFiles = (dir: string, depth: number = 0) => {
        if (depth > maxDepth || files.length > maxFiles) {
            return;
        }

        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                if (files.length > maxFiles) {
                    break;
                }

                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    // Skip more unnecessary directories to improve performance
                    const skipDirs = [
                        'node_modules', '.git', 'dist', 'build', '.vscode',
                        '.next', '.nuxt', 'coverage', '.nyc_output',
                        'tmp', 'temp', '.cache', '.parcel-cache'
                    ];
                    if (!skipDirs.includes(entry.name) && !entry.name.startsWith('.')) {
                        searchFiles(fullPath, depth + 1);
                    }
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name);
                    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
                        files.push(fullPath);
                    }
                }
            }
        } catch (error) {
            // Silently ignore permission errors, etc.
        }
    };

    searchFiles(rootPath);
    return files;
}

// Find the most specific node (including identifiers)
function findMostSpecificNodeAtPosition(sourceFile: ts.SourceFile, position: number): ts.Node | null {
    let result: ts.Node | null = null;
    let bestStart = -1;
    let bestEnd = Infinity;

    function visit(node: ts.Node) {
        const start = node.getStart(sourceFile);
        const end = node.getEnd();

        if (position >= start && position < end) {
            // If this node is more precise than previously found (smaller range), update result
            if (start > bestStart || (start === bestStart && end < bestEnd)) {
                result = node;
                bestStart = start;
                bestEnd = end;
            }

            // Continue visiting child nodes
            ts.forEachChild(node, visit);
        }
    }

    visit(sourceFile);
    return result;
}

export function deactivate() {
    languageService = null;
    program = null;
    typeChecker = null;
    serviceHost = null;
    fileCache.clear();
    fileVersions.clear();
    isServiceInitialized = false;
    currentWorkspaceRoot = null;
}
