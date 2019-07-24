import fs from 'fs'
import yaml from 'js-yaml';
import {parse} from 'flatted/esm';

function get(filename) {
  const content = fs.readFileSync(filename, 'utf8')
  return content
}

function getYaml(filename) {
  const content = fs.readFileSync(filename, 'utf8')
  return yaml.safeLoad(content)
}

function getJson(filename, options) {
  const content = fs.readFileSync(filename, options)
  return parse(content)
}

export default {
  get,
  getYaml,
  getJson,
}
