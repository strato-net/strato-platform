{-# LANGUAGE QuasiQuotes #-}
module ParserSpec where

import Control.Monad
import Test.Hspec
import Test.HUnit (assertEqual)
import Text.Parsec
import Text.RawString.QQ

import SolidVM.Solidity.Xabi.Statement
import SolidVM.Solidity.Parse.Lexer
import SolidVM.Solidity.Parse.Statement

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
                ]
    forM_ cases $ \(input, want) -> do
      it ("can parse " ++ input) $ parseExpr input `shouldBe` Right want

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
