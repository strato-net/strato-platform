module ParserSpec where

import Control.Monad
import Test.Hspec
import Text.Parsec

import SolidVM.Solidity.Xabi.Statement
import SolidVM.Solidity.Parse.Statement

spec :: Spec
spec = do
  describe "Expression parsing" $ do
    let parseExpr = runParser expression "" ""
        cases = [ ("x++", PlusPlus (Variable "x"))
                , ("++x", Unitary "++" (Variable "x"))
                ]
    forM_ cases $ \(input, want) -> do
      it ("can parse " ++ input) $ parseExpr input `shouldBe` Right want
