import fs from "fs";
import path from "path";

function replaceInFiles(directory, searchString, replacement) {
  fs.readdirSync(directory).forEach((file) => {
    const filePath = path.join(directory, file);
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      replaceInFiles(filePath, searchString, replacement);
    } else if (stats.isFile() && file.endsWith(".sol")) {
      let content = fs.readFileSync(filePath, "utf8");
      content = content.replace(new RegExp(searchString, "g"), replacement);
      fs.writeFileSync(filePath, content, "utf8");
    }
  });
}

function deleteFilesInDir(directory) {
  fs.readdir(directory, (err, files) => {
    if (err) {
      console.error(`Unable to scan directory: ${directory}`, err);
      return;
    }
    for (const file of files) {
      const filePath = path.join(directory, file);
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) {
          console.error(`Error deleting file: ${filePath}`, unlinkErr);
        } else {
          console.log(`Deleted file: ${filePath}`);
        }
      });
    }
  });
}

export { replaceInFiles, deleteFilesInDir };