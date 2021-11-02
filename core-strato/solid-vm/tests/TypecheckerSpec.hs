{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
module TypecheckerSpec where

import           Blockchain.SolidVM.CodeCollectionDB
import qualified Data.Map as M
import           Data.Source
import           Data.Text (Text)
import qualified Data.Text as T
import qualified SolidVM.Solidity.Detectors.Typechecker                            as Typechecker
import           Test.Hspec
import           Text.RawString.QQ

runTypechecker :: String -> [SourceAnnotation Text]
runTypechecker c = case compileSourceWithAnnotations (M.fromList [("",T.pack c)]) of
  Left anns -> anns
  Right cc -> Typechecker.detector cc

spec :: Spec
spec = describe "Typechecker tests" $ do
  it "can detect type errors in state variable declarations" $
    let anns = runTypechecker [r|
contract A {
  uint x = "hello";
}
|]
     in length anns `shouldBe` 1