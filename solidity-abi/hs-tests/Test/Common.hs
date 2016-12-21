{-# OPTIONS_GHC -fno-warn-orphans #-}
module Test.Common (module Test.Common, TestTree, Assertion, testGroup) where

import Test.Tasty
import Test.Tasty.HUnit

type TestM = Either String

runTestM :: (a -> Assertion) -> TestM a -> Assertion
runTestM = either assertFailure

makeTest :: String -> (a -> Assertion) -> TestM a -> TestTree
makeTest name tester result = testCase name $ runTestM tester result

doTests :: String -> (a -> TestTree) -> [a] -> TestTree
doTests name testMaker = testGroup name . map testMaker

infixr 2 |!
(|!) :: Bool -> String -> Assertion
(|!) b e = if b then assertSuccess else assertFailure e

assertSuccess :: Assertion
assertSuccess = return ()
