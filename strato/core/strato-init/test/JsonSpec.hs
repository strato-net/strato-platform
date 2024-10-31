{-# LANGUAGE OverloadedStrings #-}

module JsonSpec where

import Blockchain.Data.ChainInfo
import Blockchain.Data.GenesisInfo
import Blockchain.Database.MerklePatricia.StateRoot
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.Keccak256
import Data.Aeson
import qualified Data.ByteString as BS
import qualified Data.JsonStream.Parser as JS
import Data.Time.Calendar
import Data.Time.Clock
import qualified LabeledError
import Test.Hspec

spec :: Spec
spec = do
  describe "Account info" $ do
    it "parses existing accountinfo correctly" $
      let input =
            "[\"e1fd0d4a52b75a694de8b55528ad48e2e2cf7859\"\
            \,1809251394333065553493296640760748560207343510400633813116524750123642650624]"
          want =
            Right $
              NonContract
                (Address 0xe1fd0d4a52b75a694de8b55528ad48e2e2cf7859)
                1809251394333065553493296640760748560207343510400633813116524750123642650624
          got = eitherDecode input
       in got `shouldBe` want

    it "parses augmented accountinfo correctly" $
      let input =
            "[\"e1fd0d4a52b75a694de8b55528ad48e2e2cf7859\"\
            \,1809251394333065553493296640760748560207343510400633813116524750123642650624\
            \,\"ed92eeba73797150099ef9035b92e3bc3a3cd3b18da36f51385910726606e1f1\"]"
          want =
            Right $
              ContractNoStorage
                (Address 0xe1fd0d4a52b75a694de8b55528ad48e2e2cf7859)
                1809251394333065553493296640760748560207343510400633813116524750123642650624
                (ExternallyOwned $ unsafeCreateKeccak256FromWord256 0xed92eeba73797150099ef9035b92e3bc3a3cd3b18da36f51385910726606e1f1)
          got = eitherDecode input
       in got `shouldBe` want

    it "Parses storage in accountinfo correctly" $
      let input =
            "[\"e1fd0d4a52b75a694de8b55528ad48e2e2cf7859\"\
            \,909090909090909090\
            \,\"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\"\
            \,[[\"26a54d859003c49ea00384498c11dd9f3ec99d4b56b89b90662e6b16ea12bfbf\"  \
            \  ,\"0a94fd1bcabfd728d386de8b2e1d94f4cbce9b8d0286105239acb929d8a298fd\"] \
            \ ,[\"2663ad8b7c4a0cf2bff889181d195381a043c512716163b62ef42cc6c956bc23\"  \
            \  ,\"ba58d1f405cbbc25c28b14da5e0946f6b9f908b2813d956a4d74513f532fafc9\"]]]"
          want =
            Right $
              ContractWithStorage
                (Address 0xe1fd0d4a52b75a694de8b55528ad48e2e2cf7859)
                909090909090909090
                (ExternallyOwned $ unsafeCreateKeccak256FromWord256 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff)
                [ ( 0x026a54d859003c49ea00384498c11dd9f3ec99d4b56b89b90662e6b16ea12bfbf,
                    0x0a94fd1bcabfd728d386de8b2e1d94f4cbce9b8d0286105239acb929d8a298fd
                  ),
                  ( 0x2663ad8b7c4a0cf2bff889181d195381a043c512716163b62ef42cc6c956bc23,
                    0xba58d1f405cbbc25c28b14da5e0946f6b9f908b2813d956a4d74513f532fafc9
                  )
                ]
          got = eitherDecode input
       in got `shouldBe` want

  describe "Genesis Info" $ do
    it "parses mixed accountinfo correctly" $
      let input =
            "{ \
            \          \"logBloom\":\"00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000\",\
            \          \"accountInfo\":[\
            \            [\"e1fd0d4a52b75a694de8b55528ad48e2e2cf7859\"\
            \              ,1809251394333065553493296640760748560207343510400633813116524750123642650624],\
            \            [\"692a70d2e424a56d2c6c27aa97d1a86395877b3a\",9000\
            \             ,\"ed92eeba73797150099ef9035b92e3bc3a3cd3b18da36f51385910726606e1f1\"]],\
            \          \"transactionRoot\":\"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421\",\
            \          \"extraData\":0,\
            \          \"gasUsed\":0,\
            \          \"gasLimit\":22517998136852480000000000000000,\
            \          \"unclesHash\":\"1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347\",\
            \          \"mixHash\":\"0000000000000000000000000000000000000000000000000000000000000000\",\
            \          \"receiptsRoot\":\"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421\",\
            \          \"number\":0,\
            \          \"difficulty\":8192,\
            \          \"timestamp\":\"1970-01-01T00:00:00.000Z\",\
            \          \"coinbase\":{\"orgName\": \"BlockApps\", \"orgUnit\": \"Engineering\", \"commonName\": \"Admin\", \"access\": true},\
            \          \"parentHash\":\"0000000000000000000000000000000000000000000000000000000000000000\",\
            \          \"nonce\":42\
            \       }"
          want =
            Right $
              GenesisInfo
                { genesisInfoParentHash = unsafeCreateKeccak256FromWord256 0,
                  genesisInfoUnclesHash = unsafeCreateKeccak256FromWord256 0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347,
                  genesisInfoCoinbase = CommonName "BlockApps" "Engineering" "Admin" True,
                  genesisInfoAccountInfo =
                    [ NonContract
                        (Address 0xe1fd0d4a52b75a694de8b55528ad48e2e2cf7859)
                        1809251394333065553493296640760748560207343510400633813116524750123642650624,
                      ContractNoStorage
                        (Address 0x692a70d2e424a56d2c6c27aa97d1a86395877b3a)
                        9000
                        (ExternallyOwned $ unsafeCreateKeccak256FromWord256 0xed92eeba73797150099ef9035b92e3bc3a3cd3b18da36f51385910726606e1f1)
                    ],
                  genesisInfoCodeInfo = [],
                  genesisInfoTransactionRoot =
                    StateRoot . LabeledError.b16Decode "JsonSpec.hs" $
                      "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
                  genesisInfoReceiptsRoot =
                    StateRoot . LabeledError.b16Decode "JsonSpec.hs" $
                      "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
                  genesisInfoLogBloom = BS.replicate 256 0,
                  genesisInfoDifficulty = 8192,
                  genesisInfoNumber = 0,
                  genesisInfoGasLimit = 22517998136852480000000000000000,
                  genesisInfoGasUsed = 0,
                  genesisInfoTimestamp = UTCTime (fromGregorian 1970 0 1) (secondsToDiffTime 0),
                  genesisInfoExtraData = 0,
                  genesisInfoMixHash = unsafeCreateKeccak256FromWord256 0,
                  genesisInfoNonce = 42
                }
          got = eitherDecode input
       in got `shouldBe` want

    it "efficiently parses mixed accountinfo correctly" $
      let input =
            "{ \
            \          \"logBloom\":\"00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000\",\
            \          \"accountInfo\":[\
            \            [\"e1fd0d4a52b75a694de8b55528ad48e2e2cf7859\"\
            \              ,1809251394333065553493296640760748560207343510400633813116524750123642650624],\
            \            [\"692a70d2e424a56d2c6c27aa97d1a86395877b3a\",9000\
            \             ,\"ed92eeba73797150099ef9035b92e3bc3a3cd3b18da36f51385910726606e1f1\"]],\
            \          \"transactionRoot\":\"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421\",\
            \          \"extraData\":0,\
            \          \"gasUsed\":0,\
            \          \"gasLimit\":22517998136852480000000000000000,\
            \          \"unclesHash\":\"1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347\",\
            \          \"mixHash\":\"0000000000000000000000000000000000000000000000000000000000000000\",\
            \          \"receiptsRoot\":\"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421\",\
            \          \"number\":0,\
            \          \"difficulty\":8192,\
            \          \"timestamp\":\"1970-01-01T00:00:00.000Z\",\
            \          \"coinbase\":{\"orgName\": \"BlockApps\", \"orgUnit\": \"Engineering\", \"commonName\": \"Admin\", \"access\": true},\
            \          \"parentHash\":\"0000000000000000000000000000000000000000000000000000000000000000\",\
            \          \"nonce\":42\
            \       }"
          want =
            [ GenesisInfo
                { genesisInfoParentHash = unsafeCreateKeccak256FromWord256 0,
                  genesisInfoUnclesHash = unsafeCreateKeccak256FromWord256 0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347,
                  genesisInfoCoinbase = CommonName "BlockApps" "Engineering" "Admin" True,
                  genesisInfoAccountInfo =
                    [ NonContract
                        (Address 0xe1fd0d4a52b75a694de8b55528ad48e2e2cf7859)
                        1809251394333065553493296640760748560207343510400633813116524750123642650624,
                      ContractNoStorage
                        (Address 0x692a70d2e424a56d2c6c27aa97d1a86395877b3a)
                        9000
                        (ExternallyOwned $ unsafeCreateKeccak256FromWord256 0xed92eeba73797150099ef9035b92e3bc3a3cd3b18da36f51385910726606e1f1)
                    ],
                  genesisInfoCodeInfo = [],
                  genesisInfoTransactionRoot =
                    StateRoot . LabeledError.b16Decode "JsonSpec.hs" $
                      "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
                  genesisInfoReceiptsRoot =
                    StateRoot . LabeledError.b16Decode "JsonSpec.hs" $
                      "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
                  genesisInfoLogBloom = BS.replicate 256 0,
                  genesisInfoDifficulty = 8192,
                  genesisInfoNumber = 0,
                  genesisInfoGasLimit = 22517998136852480000000000000000,
                  genesisInfoGasUsed = 0,
                  genesisInfoTimestamp = UTCTime (fromGregorian 1970 0 1) (secondsToDiffTime 0),
                  genesisInfoExtraData = 0,
                  genesisInfoMixHash = unsafeCreateKeccak256FromWord256 0,
                  genesisInfoNonce = 42
                }
            ]
          got = JS.parseLazyByteString genesisParser input
       in got `shouldBe` want
