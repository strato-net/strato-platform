import fs from 'fs';
import path from 'path';

function replaceInFiles(directory, searchString, replacement) {
  fs.readdirSync(directory).forEach(file => {
    const filePath = path.join(directory, file);
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      replaceInFiles(filePath, searchString, replacement);
    } else if (stats.isFile() && file.endsWith('.sol')) {
      let content = fs.readFileSync(filePath, 'utf8');
      content = content.replace(new RegExp(searchString, 'g'), replacement);
      fs.writeFileSync(filePath, content, 'utf8');
    }
  });
}

export { replaceInFiles };