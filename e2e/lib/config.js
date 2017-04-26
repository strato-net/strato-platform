// ----------------------------------
// setup command line args
// @see https://www.npmjs.com/package/commander
// ----------------------------------
const commander = require('commander');
const fs = require('fs');
const yaml = require('js-yaml');

// read a yaml or die
function getYamlFile(yamlFilename) {
    return yaml.safeLoad(fs.readFileSync(yamlFilename, 'utf8'));
}

commander
  .version('0.0.2')
  .option('-c, --config [path]', 'Config file [config.yaml]', 'config.yaml')
  .option('-d, --api-debug', 'API debug trace')
  .parse(process.argv);

console.log('config file:', commander.config);
const configFile = getYamlFile(commander.config);
// cli overrides config
if (commander.apiDebug) configFile.apiDebug = true;
if (commander.timeout !== undefined) configFile.timeout = commander.timeout;
console.log(configFile);

exports.configFile = configFile;

configFile.getBlocUrl = function (node) {
  if (node === undefined) node = 0;
  return this.nodes[node].blocUrl;
}
configFile.getExplorerUrl = function (node) {
  if (node === undefined) node = 0;
  return this.nodes[node].explorerUrl;
}
configFile.getStratoUrl = function (node) {
  if (node === undefined) node = 0;
  return this.nodes[node].stratoUrl;
}
