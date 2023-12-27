{-# LANGUAGE OverloadedStrings #-}

module BlockApps.SolidityVarReaderSpec where

--import qualified Data.Map.Strict as M

import BlockApps.Solidity.Struct
--import BlockApps.Storage
--import BlockApps.Solidity.Contract
import BlockApps.Solidity.Type
--import BlockApps.Solidity.TypeDefs
import BlockApps.Solidity.Value
import BlockApps.SolidityVarReader (structSort)
--import BlockApps.SolidityVarReader (decodeCacheValues, structSort)

import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Control.Monad
import qualified Data.IntMap as I
import qualified Data.Map.Ordered as OM
import qualified Data.Text as T
import Test.Hspec

addr :: Address -> Value
addr = SimpleValue . ValueAccount . unspecifiedChain

structFromFields :: [T.Text] -> Struct
structFromFields ts =
  Struct (OM.fromList [(t, (Left t, SimpleType TypeAccount)) | t <- ts])
    . fromIntegral
    $ length ts

spec :: Spec
spec = do
  it "should be able to struct sort" $ do
    let cases =
          [ ( structFromFields ["a"],
              [("a", addr 0x77)],
              [("a", addr 0x77)]
            ),
            ( structFromFields ["a", "b"],
              [("a", addr 20), ("b", addr 42)],
              [("a", addr 20), ("b", addr 42)]
            ),
            ( structFromFields ["a", "b"],
              [("b", addr 80), ("a", addr 234)],
              [("a", addr 234), ("b", addr 80)]
            ),
            ( structFromFields ["d", "c", "b", "a"],
              [("a", addr 0xa), ("c", addr 0xc), ("d", addr 0xd), ("b", addr 0xb)],
              [("d", addr 0xd), ("c", addr 0xc), ("b", addr 0xb), ("a", addr 0xa)]
            )
          ]
    forM_ cases $ \(tipe, input, want) -> structSort tipe input `shouldBe` want

  it "should be able to unsparse an array" $ do
    let int = SimpleValue . valueInt
    unsparse (I.singleton 0 (ValueArraySentinel 0)) `shouldBe` []
    unsparse (I.fromList [(1, addr 9), (3, ValueArraySentinel 3)]) `shouldBe` [addr 0, addr 9, addr 0]
    unsparse (I.singleton 2 (ValueArraySentinel 2)) `shouldBe` [int 0, int 0]

{-
  it "should be able to decode arrays of strings" $ do
    let spine = ValueArrayDynamic . tosparse . map (SimpleValue . ValueString)
        oldState = [("xs", spine [])]
        wantState = [("xs", spine ["first", "second", "third"])]
        listType = TypeArrayDynamic (SimpleType TypeString)
        contract = Contract (Struct (OM.singleton ("xs", (Right $ Position 0 0, listType))) 32)
                            (TypeDefs M.empty M.empty)
        storageMap = M.fromList
          [ ( 0x0000000000000000000000000000000000000000000000000000000000000000
            , 0x0000000000000000000000000000000000000000000000000000000000000003
            )
          , ( 0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563
            , 0x666972737400000000000000000000000000000000000000000000000000000a
            )
          , ( 0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e564
            , 0x7365636f6e64000000000000000000000000000000000000000000000000000c
            )
          , ( 0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e565
            , 0x746869726400000000000000000000000000000000000000000000000000000a
            )
          ]
    decodeCacheValues contract (flip M.lookup storageMap) oldState `shouldBe` wantState
-}
