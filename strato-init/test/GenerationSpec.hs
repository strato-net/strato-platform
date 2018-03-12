{-# LANGUAGE OverloadedStrings #-}
module GenerationSpec where
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16
import Test.Hspec

import Blockchain.Data.GenesisInfo
import Blockchain.Generation
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.SHA

start :: GenesisInfo
start = defaultGenesisInfo

emptyContract :: BS.ByteString
emptyContract = B16.encode "60606040525b600080fd00a165627a7a723058209b97b86115f9dfccb5f10ab93044730e948264e405825b26dccd1605775663710029"

emptyHash :: SHA
emptyHash = SHA 0x6ee829aad0ec74494a6cf1433f563bbbe7e556a2a067d6ecd596dda0aecd8202

sharedStart :: Address
sharedStart = Address 0x692a70d2e424a56d2c6c27aa97d1a86395877b3a
-- sharedStart = Address 0x17

spec :: Spec
spec = do
  describe "Insertion of empty contracts" $ do
    it "should insert no contracts" $
      let input = defaultGenesisInfo
          want = []
          got = insertContracts emptyContract sharedStart 0 input
      in genesisInfoAccountInfo got `shouldBe` want

    it "should insert 1 contract" $
      let input = defaultGenesisInfo
          want = [Contract sharedStart 0 emptyHash]
          got = insertContracts emptyContract sharedStart 1 input
      in genesisInfoAccountInfo got `shouldBe` want

    it "should insert 1m contracts" $
      let total = 1000000 :: Integer
          input = defaultGenesisInfo
          want = map (\n -> Contract (sharedStart + fromIntegral n) 0 emptyHash) [0..total-1]
          got = insertContracts emptyContract sharedStart total input
      in genesisInfoAccountInfo got `shouldBe` want
