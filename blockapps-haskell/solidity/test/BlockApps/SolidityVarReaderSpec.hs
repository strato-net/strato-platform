{-# LANGUAGE OverloadedStrings #-}
module BlockApps.SolidityVarReaderSpec where

import Control.Monad
import qualified Data.IntMap as I
import qualified Data.Map.Ordered as OM
import Test.Hspec

import BlockApps.Ethereum
import BlockApps.Solidity.Struct
import qualified Data.Text as T
import BlockApps.Solidity.Type
import BlockApps.Solidity.Value
import BlockApps.SolidityVarReader (structSort)

addr :: Address -> Value
addr = SimpleValue . ValueAddress


structFromFields :: [T.Text] -> Struct
structFromFields ts = Struct (OM.fromList [(t, (Left t, SimpleType TypeAddress)) | t <- ts])
                    . fromIntegral $ length ts

spec :: Spec
spec = do
  it "should be able to struct sort" $ do
    let cases = [ (structFromFields ["a"]
                    , [("a", addr 0x77)]
                    , [("a", addr 0x77)])
                , (structFromFields ["a", "b"]
                    , [("a", addr 20), ("b", addr 42)]
                    , [("a", addr 20), ("b", addr 42)])
                , (structFromFields ["a", "b"]
                    , [("b", addr 80), ("a", addr 234)]
                    , [("a", addr 234), ("b", addr 80)]
                    )
                , (structFromFields ["d", "c", "b", "a"]
                      , [("a", addr 0xa), ("c", addr 0xc), ("d", addr 0xd), ("b", addr 0xb)]
                      , [("d", addr 0xd), ("c", addr 0xc), ("b", addr 0xb), ("a", addr 0xa)]
                      )
                ]
    forM_ cases $ \(tipe, input, want) -> structSort tipe input `shouldBe` want

  it "should be able to unsparse an array" $ do
    let int = SimpleValue . valueInt
    unsparse (I.singleton 0 (ValueArraySentinel 0)) `shouldBe` []
    unsparse (I.fromList [(1, addr 9), (3, ValueArraySentinel 3)]) `shouldBe` [addr 0, addr 9, addr 0]
    unsparse (I.singleton 2 (ValueArraySentinel 2)) `shouldBe` [int 0, int 0]
