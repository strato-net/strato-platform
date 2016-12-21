#!/bin/bash

function testContract {
  contractSrc=$1

  echo "Contracts defined by:"
  echo "$contractSrc"
  echo "$contractSrc" | solidity-abi --stdin ImportInheritance.sol

  echo
  echo -n "Press enter to continue..."
  read
  echo
}

testContract '
import "ImportInheritance.sol";

contract NotImported is owned {}
'

testContract '
import "ImportInheritance.sol" as Imported;

contract NotImported is Imported.owned {}
'

testContract '
import * from "ImportInheritance.sol";

contract NotImported is owned {}
'

testContract '
import * as Imported from "ImportInheritance.sol";

contract NotImported is Imported.owned {}
'

testContract '
import {owned} from "ImportInheritance.sol";

contract NotImported is owned {}
'

testContract '
import {owned as free} from "ImportInheritance.sol";

contract NotImported is free {}
'

