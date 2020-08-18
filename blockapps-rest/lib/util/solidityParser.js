import parser from 'solidity-parser-antlr'

/**
 * Parses a string Solidity Contract
 *
 * @method parse
 * @param {String} input the Contract string
 * @return {Object}
 */

function parse(input) {
  return parser.parse(input)
}

/**
 * Parses enums found in a string Solidity contract
 *
 * @method parseEnum
 * @param {String} input the Contract string with Enums
 * @return {Object}
 */

function parseEnum(input) {
  const parsed = parse(input)
  const { members } = parsed.children[0].subNodes[0]
  const myEnum = members.filter(member => member.type === 'EnumValue').reduce((acc, member, index) => {
    acc[member.name] = index
    acc[index] = member.name
    return acc
  }, {})

  return myEnum
}

/**
 * Parses fields found in a string Solidity contract
 *
 * @method parseFields
 * @param {String} input the Contract string with Fields
 * @return {Object}
 */

function parseFields(input, prefix) {
  const graph = parse(input)
  const contract = graph.children.filter(child => child.type === 'ContractDefinition')[0]
  const stateVariableDeclarations = contract.subNodes.filter(child => child.type === 'StateVariableDeclaration')

  const result = stateVariableDeclarations.reduce((acc, stateVariable) => {
    const variable = stateVariable.variables[0]
    // must have an assignment expression
    if (!variable.expression) return acc
    // check prefix if needed
    if (prefix !== undefined && variable.name.indexOf(prefix) !== 0) return acc

    // extract the name->value pair
    function getNameValue(variable) {
      switch (variable.expression.type) {
        case 'StringLiteral':
          return { name: variable.name, value: variable.expression.value }
        case 'NumberLiteral':
          return { name: variable.name, value: variable.expression.number }
        default:
          throw new Error(`Unknown Expressions ${variable.expression.type}`)
      }
    }

    const { name, value } = getNameValue(variable)
    // save name -> value
    acc[name] = value
    // prevent duplicates
    if (acc[value] !== undefined) throw new Error(`Duplicate expressions value. var:${name} value:${value}`)
    // save value -> name
    acc[value] = name
    return acc
  }, {})

  return result
}

export default {
  parse,
  parseEnum,
  parseFields,
}
