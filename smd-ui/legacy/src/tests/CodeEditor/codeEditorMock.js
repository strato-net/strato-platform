export const extAbi = { "src": { "Cloner": { "funcs": { "cloneSheep": { "args": { "name": { "dynamic": true, "type": "String", "index": 0 } }, "selector": "0072c6a9", "vals": { "#0": { "type": "Address", "index": 0 } } } }, "vars": { "clones": { "atBytes": 0, "dynamic": true, "entry": { "typedef": "Sheep" }, "type": "Array", "public": true }, "sheepDNA": { "atBytes": 32, "dynamic": true, "type": "String", "public": true } } }, "Sheep": { "funcs": { "geneticallyModify": { "args": { "_dna": { "dynamic": true, "type": "String", "index": 0 } }, "selector": "0e3668f8", "vals": {} } }, "constr": { "_dna": { "dynamic": true, "type": "String", "index": 1 }, "_name": { "dynamic": true, "type": "String", "index": 0 } }, "vars": { "dna": { "atBytes": 32, "dynamic": true, "type": "String", "public": true }, "name": { "atBytes": 0, "dynamic": true, "type": "String", "public": true } } } } }
export const error = "src:6:77: Error: Expected token Semicolon got 'RBrace'\n{ Sheep sheep = new Sheep(name, sheepDNA); clones.push(sheep); return sheep }\n                                                                            ^\n"
export const selectedTabContent = {
  text: "contract Cloner {↵Sheep[] public clones;↵string public sheepDNA = \"ccc\";↵↵function cloneSheep(string name) returns (address)↵{ Sheep sheep = new Sheep(name, sheepDNA); clones.push(sheep); return sheep }↵↵}↵↵contract Sheep {↵string public name;↵string public dna;↵↵function Sheep(string _name, string _dna)↵{ name = _name; dna = _dna; }↵↵function geneticallyModify(string _dna)↵{ dna = _dna; }↵↵}",
  title: "abc.sol"
}
export const tab2 = {
  text: "contract Cloner {↵Sheep[] public clones;↵string public sheepDNA = \"ccc\";↵↵function cloneSheep(string name) returns (address)↵{ Sheep sheep = new Sheep(name, sheepDNA); clones.push(sheep); return sheep }↵↵}↵↵contract Sheep {↵string public name;↵string public dna;↵↵function Sheep(string _name, string _dna)↵{ name = _name; dna = _dna; }↵↵function geneticallyModify(string _dna)↵{ dna = _dna; }↵↵}",
  title: "xyz.sol"
}
// having source code
export const codeEditor = {
  codeCompileSuccess: false,
  contractName: "Cloner",
  createDisabled: true,
  currentTabSelected: 0,
  enableCreateAction: false,
  error: error,
  isRemoveTab: false,
  lastTabSelected: 0,
  localCompileException: "",
  response: "src:6:77: Error: Expected token Semicolon got 'RBrace'↵{ Sheep sheep = new Sheep(name, sheepDNA); clones.push(sheep); return sheep }↵                                                                            ^↵",
  serverText: "HelloFri Nov 17 2017 15:51:33 GMT+0530 (IST)",
  sourceCode: "contract Cloner {↵Sheep[] public clones;↵string public sheepDNA = \"ccc\";↵↵function cloneSheep(string name) returns (address)↵{ Sheep sheep = new Sheep(name, sheepDNA); clones.push(sheep); return sheep }↵↵}↵↵contract Sheep {↵string public name;↵string public dna;↵↵function Sheep(string _name, string _dna)↵{ name = _name; dna = _dna; }↵↵function geneticallyModify(string _dna)↵{ dna = _dna; }↵↵}",
  timer: 87,
  tab: [selectedTabContent, tab2],
  fileName: 'SampleStorage',
}

// source code undefined import
export const sourceCodeUndefinedImport = "import \"abc.sol\";↵contract Cloner {↵Sheep[] public clones;↵string public sheepDNA = \"ccc\";↵↵function cloneSheep(string name) returns (address)↵{ Sheep sheep = new Sheep(name, sheepDNA); clones.push(sheep); return sheep }↵↵}↵↵contract Sheep {↵string public name;↵string public dna;↵↵function Sheep(string _name, string _dna)↵{ name = _name; dna = _dna; }↵↵function geneticallyModify(string _dna)↵{ dna = _dna; }↵↵}"
