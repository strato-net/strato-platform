import { getFileAndReplaceWithImport, getImportStatements, replaceImportStatementsWithSource } from '../../lib/FileParser'

const code = 'import "Greeter.sol"'
const tabData = [
  {
    text: "import \"Greeter.sol\"", title: "Main.sol"
  },
  {
    text: "contract GreeterW {↵    /* Define variable greeting of the type string */↵    string greeting;↵↵    /* This runs when the contract is executed */↵    function GreeterW(string _greeting) public {↵        greeting = _greeting;↵    }↵↵    /* Main function */↵    function greet(string _greeting) constant returns (string) {↵        return greeting;↵    }↵}↵",
    title: "Greeter.sol"
  }
]
const source = "import \"'main.sol'\";\n↵↵contract Cloner {↵Sheep[] public clones;↵string public sheepDNA = \"ccc\";↵↵function cloneSheep(string name) returns (address)↵{ Sheep sheep = new Sheep(name, sheepDNA); clones.push(sheep); return sheep }↵↵}↵↵contract Sheep {↵string public name;↵string public dna;↵↵function Sheep(string _name, string _dna)↵{ name = _name; dna = _dna; }↵↵function geneticallyModify(string _dna)↵{ dna = _dna; }↵↵}"


describe('Lib: file parser', () => {

  test('import statements', () => {
    expect(getImportStatements(source)).toMatchSnapshot();
  });

  test('import code', () => {
    expect(getFileAndReplaceWithImport(code, tabData)).toMatchSnapshot();
  });

});