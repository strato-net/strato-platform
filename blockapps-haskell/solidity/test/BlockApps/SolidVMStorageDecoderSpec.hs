{-# LANGUAGE OverloadedStrings #-}
module BlockApps.SolidVMStorageDecoderSpec where

import Data.Bifunctor
import Blockchain.SolidVM.Model
import SolidVM.Model.Storable
import Test.Hspec

toInput :: (StoragePath, BasicValue) -> (HexStorage, HexStorage)
toInput = bimap storagePathToHexStorge basicToHexStorage

spec :: Spec
spec = do
  it "can decode addresses" $ do
    let input = toInput (singleton "owner",  BAddress 0xdeadbeef)
    "hello" `shouldBe` ("goodbye" :: String)
