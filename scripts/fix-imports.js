import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = process.argv[2];

if (!srcDir) {
    console.error('Please provide the source directory path');
    process.exit(1);
}

function walk(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        isDirectory ? walk(dirPath, callback) : callback(path.join(dir, f));
    });
}

const importRegex = /(import\s+(?:[\w\s{},*]*\s+from\s+)?['"])((\.\/|\.\.\/)[^'"]+)(['"])/g;
const dynamicImportRegex = /(import\(['"])((\.\/|\.\.\/)[^'"]+)(['"]\))/g;

walk(srcDir, (filePath) => {
    if (!filePath.endsWith('.ts')) return;

    let content = fs.readFileSync(filePath, 'utf8');
    let hasChanged = false;

    const replacer = (match, p1, p2, p3, p4) => {
        // If it already has an extension (ends in .js, .json, .css, etc.), leave it
        if (p2.match(/\.(js|json|css|mjs|cjs)$/)) {
            return match;
        }
        
        // Add .js extension
        hasChanged = true;
        return p1 + p2 + '.js' + p4;
    };

    content = content.replace(importRegex, replacer);
    content = content.replace(dynamicImportRegex, replacer);

    if (hasChanged) {
        console.log(`Fixed imports in: ${filePath}`);
        fs.writeFileSync(filePath, content, 'utf8');
    }
});
