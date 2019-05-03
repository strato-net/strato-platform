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
import SolidVM.Solidity.Xabi.Type
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
                , ("int(8824)", FunctionCall (Variable "int") $ OrderedArgs [NumberLiteral 8824 Nothing])
                , ("int32(8824)", FunctionCall (Variable "int32") $ OrderedArgs [NumberLiteral 8824 Nothing])
                , ("int(x)[y]", IndexAccess (FunctionCall (Variable "int") $ OrderedArgs [Variable "x"])
                                            $ Just $ Variable "y")
                , ("xs[y].z", MemberAccess
                                (IndexAccess (Variable "xs") (Just $ Variable "y"))
                                "z")
                , ("x.f()", FunctionCall (MemberAccess (Variable "x") "f") $ OrderedArgs [])
                ]
    forM_ cases $ \(input, want) -> do
      it ("can parse " ++ input) $ parseExpr input `shouldBe` Right want

    forM_ cases $ \(want, input) -> do
      it ("can unparse to " ++ want) $ unparseExpression input `shouldBe` want

    it "can parse function calls" $ do
      let f = FunctionCall (Variable "f")
          true = OrderedArgs [BoolLiteral True]
          ok = OrderedArgs [StringLiteral "ok"]
          fcases = [ ("f(true)", f true)
                   , ("f(true\n)", f true)
                   , ("f(\"ok\")", f ok)
                   , ("f(\"ok\"\n)", f ok)
                   , ("f({})", f $ NamedArgs [])
                   , ("f({ x : y})", f $ NamedArgs [("x", Variable "y")])
                   , ("f ( { x : y , q : z } )", f $ NamedArgs [("x", Variable "y"), ("q", Variable "z")])
                   ]
      forM_ fcases $ \(input, want) -> do
        assertEqual input (Right want) (parseExpr input)

  describe "Statement parsing" $ do
    let parseStatement = runParser statement "" ""
        scases = [ ("x++;", SimpleStatement $ ExpressionStatement $ PlusPlus $ Variable "x")
                 , ("assembly { dst := mload(add(src, 32)) }",
                      AssemblyStatement $ MloadAdd32 "dst" "src")
                 , ("Nom storage nom = ns[10];", SimpleStatement $
                      VariableDefinition (Just $ Label "Nom") (Just Storage) [Just "nom"] $ Just $
                      IndexAccess (Variable "ns") (Just $ NumberLiteral 10 Nothing))
                 , ("var (x, y) = (7, 3);", SimpleStatement $
                      VariableDefinition Nothing Nothing [Just "x", Just "y"] $ Just $
                      TupleExpression $ map (\n -> Just (NumberLiteral n Nothing)) [7, 3])
                 , ("(z, w) = (q, r);", SimpleStatement $ ExpressionStatement
                      $ Binary "=" (TupleExpression $ map (Just . Variable) ["z", "w"])
                                   (TupleExpression $ map (Just . Variable) ["q", "r"]))
                 , ("(z, ) = (q, r);", SimpleStatement $ ExpressionStatement
                      $ Binary "=" (TupleExpression $ [Just $ Variable "z", Nothing])
                                   (TupleExpression $ map (Just . Variable) ["q", "r"]))
                 ]
    forM_ scases $ \(input, want) -> do
        it ("can parse " ++ input) $ parseStatement input `shouldBe` Right want

    let fcases = ["assembly {}", "assembly { dst := mload(src) }", "assembly { dst := add(src, 32) }"]
    forM_ fcases $ \input -> do
      it ("cannot parse " ++ input) $ parseStatement input `shouldSatisfy` isLeft
