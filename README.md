# Copy-Type Extension

Copy-Type is a VS Code extension for quickly copying TypeScript/JavaScript variable, function, or object type definitions. When you need to reuse a complex type or interface, this extension helps you quickly get the type information without manually searching and copying.

## Features

- **Copy type at cursor**: Use keyboard shortcuts to quickly copy the type at the current cursor position
- **Copy variable type**: Right-click in the editor to copy the type of a selected variable
- **Support for multiple file formats**: Works with `.ts`, `.tsx`, `.js`, `.jsx`, and `.vue` files

## Usage

1. **Copy type at cursor**:
   - Place your cursor on any TypeScript variable, function, or object
   - Press `Ctrl+Alt+C` (or `Cmd+Alt+C` on Mac)
   - The type information will be copied to your clipboard

2. **Copy variable type using context menu**:
   - Right-click on a variable, function, or object
   - Select "Copy Variable Type" from the context menu
   - The type information will be copied to your clipboard

## Setting Up Keyboard Shortcuts

This extension does not provide default keyboard shortcuts to avoid conflicts with other extensions. You can easily set up your own custom shortcuts:

1. Open VS Code Keyboard Shortcuts settings by pressing `Ctrl+K Ctrl+S` (`Cmd+K Cmd+S` on Mac)
2. Search for "copy-type" to find the extension commands:
   - `Copy Type at Cursor` - copies the type at the current cursor position
   - `Copy Variable Type` - copies the type of a selected variable
3. Click on the pencil icon next to a command to assign a keyboard shortcut
4. Press your desired key combination and save

**Suggested shortcuts:**
- `Ctrl+Alt+C` (`Cmd+Alt+C` on Mac) for "Copy Type at Cursor"
- `Ctrl+Alt+V` (`Cmd+Alt+V` on Mac) for "Copy Variable Type"

## Supported File Types

- TypeScript (`.ts`)
- TypeScript React (`.tsx`)
- JavaScript (`.js`)
- JavaScript React (`.jsx`)
- Vue (`.vue`) files with TypeScript code

## Known Issues

- For very complex nested types, extraction may be incomplete
- In some cases, generic type parameters may not be correctly identified
- Type extraction in Vue files depends on Volar/Vetur plugin support

## Version History

### 0.0.1

- Initial release
- Support for copying types using keyboard shortcuts and context menu

## Contributing

Feel free to submit issue reports and feature requests to the project's GitHub repository.

**Enjoy!**
