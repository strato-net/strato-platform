import fs from 'fs'
import yaml from 'js-yaml';

/**
 * Reads a file and return its content
 * @method get
 * @return {String}
 */

function get(filename) {
  const content = fs.readFileSync(filename, 'utf8')
  return content
}

/**
 * Reads a yaml file and return its content
 * @method getYaml
 * @return {String}
 */

function getYaml(filename) {
  const content = fs.readFileSync(filename, 'utf8')
  return yaml.safeLoad(content)
}

/**
 * Reads a JSON file and return its content
 * @method getJson
 * @return {String}
 */

function getJson(filename, options) {
  const content = fs.readFileSync(filename, options)
  return JSON.parse(content)
}

export default {
  get,
  getYaml,
  getJson,
}
