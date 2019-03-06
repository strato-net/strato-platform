{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
module ParserSpec where

import Control.Monad
import Data.Either (isLeft)
import Test.Hspec
import Test.HUnit (assertEqual)
import Text.Parsec
import Text.RawString.QQ

import SolidVM.Solidity.Xabi.Statement
import SolidVM.Solidity.Parse.Lexer
import SolidVM.Solidity.Parse.Statement
import SolidVM.Solidity.Parse.UnParser

spec :: Spec
spec = do
  describe "String lexing" $ do
    let parseStr = runParser (stringLiteral <* eof) "" ""
        cases = [ ([r|"ok"|], "ok")
                , ([r|"ok" |], "ok")
                ]
    forM_ cases $ \(input, want) -> do
      it ("can parse " ++ show input) $ parseStr input `shouldBe` Right want

  describe "Expression parsing" $ do
    let parseExpr = runParser expression "" ""
        cases = [ ("x++", PlusPlus (Variable "x"))
                , ("++x", Unitary "++" (Variable "x"))
                , ("--x", Unitary "--" (Variable "x"))
                , ("x--", MinusMinus (Variable "x"))
                , ("x + y", Binary "+" (Variable "x") (Variable "y"))
                , ("x ** y", Binary "**" (Variable "x") (Variable "y"))
                , ("x[q]", IndexAccess (Variable "x") (Just $ Variable "q"))
                , ("x[a][b][c]", IndexAccess (
                                   IndexAccess (
                                     IndexAccess
                                       (Variable "x")
                                       (Just $ Variable "a"))
                                     (Just $ Variable "b"))
                                   (Just $ Variable "c"))
                ]
    forM_ cases $ \(input, want) -> do
      it ("can parse " ++ input) $ parseExpr input `shouldBe` Right want

    forM_ cases $ \(want, input) -> do
      it ("can unparse to " ++ want) $ unparseExpression input `shouldBe` want

    it "can parse function calls" $ do
      let f = FunctionCall (Variable "f")
          true = [(Nothing, BoolLiteral True)]
          ok = [(Nothing, StringLiteral "ok")]
          fcases = [ ("f(true)", f true)
                   , ("f(true\n)", f true)
                   , ("f(\"ok\")", f ok)
                   , ("f(\"ok\"\n)", f ok)
                   ]
      forM_ fcases $ \(input, want) -> do
        assertEqual input (Right want) (parseExpr input)

  describe "Statement parsing" $ do
    let parseStatement = runParser statement "" ""
        scases = [ ("x++;", SimpleStatement $ ExpressionStatement $ PlusPlus $ Variable "x")
                 , ("assembly { dst := mload(add(src, 32)) }",
                      AssemblyStatement $ MloadAdd32 "dst" "src")
                 ]
    forM_ scases $ \(input, want) -> do
        it ("can parse " ++ input) $ parseStatement input `shouldBe` Right want

    let fcases = ["assembly {}", "assembly { dst := mload(src) }", "assembly { dst := add(src, 32) }"]
    forM_ fcases $ \input -> do
      it ("cannot parse " ++ input) $ parseStatement input `shouldSatisfy` isLeft
