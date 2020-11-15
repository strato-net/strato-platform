import * as fs from 'fs'
import * as nodepath from 'path'
const cwd = nodepath.resolve(process.cwd());

let nameStore = [];

/**
 * This is the importer interface
 * @module importer
 */

function getImportsTree(fullname) {
  // console.log('getImportsTree', fullname);
  let importFullnames = [];
  isImported(fullname);
  let array = fs.readFileSync(fullname).toString().split('\n');
  let parentPath = splitPath(fullname);
  for (let i = 0; i < array.length; i++) {
    let line = array[i];
    if (line.startsWith('import')) {
      // console.log('getImportsTree', 'line', line);
      let importName = getImportName(line);
      let importFullname = parentPath + nodepath.sep + importName;
      // console.log('getImportsTree', 'importFullname', importFullname);
      if (isImported(importFullname)) continue;
      importFullnames.push(importFullname);
      importFullnames = importFullnames.concat(getImportsTree(importFullname));
    }
  }
  return importFullnames;
}

// supported formats:
// import * as symbolName from "filename";
// import {symbol1 as alias, symbol2} from "filename";
// import "filename";
function getImportName(line) {
  let importName = line.split('"').slice(-2, -1)[0];
  // console.log('importName', importName);
  return importName;
}

/**
 * readFileLines() reads a root file and parse all imports recursively
 *
 * @method readFileLines
 * @param {Object} initial import map
 * @param {String} input name of file to be read
 * @return {String}
 */

function readFileLines(initialFileMap, fullname) {
  const array = fs.readFileSync(fullname).toString().split('\n');
  isImported(fullname);
  const { fileMap, buffer } = array.reduce((obj, line) => {
    const { fileMap, buffer } = obj;
    if (line.startsWith('import')) {
      const newBuffer = buffer + '//' + line + '\n';
      const newFileMap = importFile(fileMap, fullname, line);
      return { fileMap: newFileMap, buffer: newBuffer }
    } else {
      const fixedLine = line.replace('\r', ' '); // Windows fix
      const newBuffer = buffer + fixedLine + '\n';
      return { fileMap, buffer: newBuffer }
    }
  }, {fileMap: initialFileMap, buffer: ''});
  const shortName = getShortName(fullname)
  return { ...fileMap, [shortName]: buffer }
}

//
//  importFile() reconstruct the import file path, and read it, unless it was already imported
//
//  @param {String} fullname
//  @param {String} line - the import line command
// /

/**
 * importFile() reconstruct the import file path, and read it, unless it was already imported
 *
 * @method importFile
 * @param {Object} fileMap the initial import map
 * @param {String} fullname name of file
 * @param {String} line the import line command
 * @return {String}
 */

function importFile(fileMap, fullname, line) {
  let importName = line.replace(/import[\s]+/i, '').replace(/\"/gi, '').replace(';', '');
  importName = importName.replace('\r', '');  // Windows fix
  if (isImported(importName)) {
    return fileMap;
  }
  // if import name starts with '/' - read relative to project root -LS
  if (importName.indexOf('/') == 0) {
    return readFileLines(fileMap, nodepath.join(cwd, importName));
  }
  let parentPath = splitPath(fullname);
  return readFileLines(fileMap, nodepath.join(parentPath, importName));
}

// isImported() checks if a file is already imported
//
// @param {String} fullname
// @returns {Boolean} isImported
//

/**
 * isImported() checks if a file is already imported
 *
 * @method isImported
 * @param {String} fullname name of file
 * @return {Boolean}
 */

function getShortName(fullname) {
  let array = fullname.split(nodepath.sep);
  array = array.length <= 1 ? fullname.split('/') : array; // Windows fix
  return array.pop();
}

function isImported(fullname) {
  const name = getShortName(fullname);
  if (nameStore.indexOf(name) > -1) {
    return true;
  }
  nameStore.push(name);
  return false;
}

/**
 * splitPath() get the path part of a full name
 *
 * @method splitPath
 * @param {String} fullname name of file
 * @return {Array}
 */

function splitPath(fullname) {
  let array = fullname.split(nodepath.sep);
  array = array.length <= 1 ? fullname.split('/') : array; // Windows fix
  let path = array.slice(0, array.length - 1).join(nodepath.sep);
  return path;
}

function combine(filename):Promise<string> {
  nameStore = [];
  return new Promise(function(resolve, reject) {
    const string = readFileLines({}, filename);
    resolve(string);
  });
}

export default {
  combine,
}
