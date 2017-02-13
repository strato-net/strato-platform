
import Test.Tasty

import ArrayDeclarations
import FunctionDeclarations
import MappingDeclarations
import SyntaxFails
import StructEnumDeclarations
import SimpleDeclarations

import PrimitiveState
import ComplexState

import Test.HSpec
import BlockApps.SoliditySpec

main = do
  hspec spec
  defaultMain tests

tests :: TestTree
tests = testGroup "tests" [ parseTests
                          , stateTests
                          ]

parseTests = testGroup "parse tests"
  [
    test_simple_decl,
    test_array_decl,
    test_func_decl,
    test_struct_decl,
    test_syntax_fails,
    test_mapping_decl,
    test_struct_decl
  ]


stateTests = testGroup "state tests"
  [
    test_primitive_state
  , test_complex_state
  ]
