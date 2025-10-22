{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.GenesisBlocks.Contracts.Decide
  ( insertDecideContract,
  )
where

import           Blockchain.Data.GenesisInfo
import           Blockchain.GenesisBlocks.Contracts.TH
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.CodePtr
import qualified Blockchain.Strato.Model.Keccak256 as KECCAK256
import           Data.ByteString                   (ByteString)
import           Data.Map                          (Map)
import qualified Data.Map                          as Map
import           Data.Maybe
import           Data.Text.Encoding
import           SolidVM.Model.Storable

blockappsAddress :: Address
blockappsAddress = 0x1b7dc206ef2fe3aab27404b88c36470ccf16c0ce -- 0x0dbb9131d99c8317aa69a70909e124f2e02446e8

mercataAddress :: Address
mercataAddress = 0x1000

-- | Inserts the 0xDEC1DE and contract 0xDEC1DE02 into the genesis block with the BlockApps root cert as owner
insertDecideContract :: GenesisInfo -> GenesisInfo
insertDecideContract gi =
  gi
    { genesisInfoAccountInfo = genesisInfoAccountInfo gi ++ [decideAcct] ++ [decideStateAcct],
      genesisInfoCodeInfo = genesisInfoCodeInfo gi
                         ++ [ CodeInfo (decodeUtf8 dec1deContract) (Just "Decider")
                            , CodeInfo (decodeUtf8 dec1deStateContract) (Just "DeciderState")
                            ]
    }
  where
    decideAcct =
      SolidVMContractWithStorage
        0xDEC1DE
        0
        (SolidVMCode "Decider" $ KECCAK256.hash dec1deContract)
        []
    decideStateAcct =
      SolidVMContractWithStorage
        0xDEC1DE02
        0
        (SolidVMCode "DeciderState" $ KECCAK256.hash dec1deStateContract)
        [ (".:creator", BString $ encodeUtf8 "BlockApps"),
          (".:creatorAddress", BAccount $ unspecifiedChain blockappsAddress),
          (".:originAddress", BAccount $ unspecifiedChain mercataAddress),
          (".owner", BAccount $ unspecifiedChain blockappsAddress),
          (".currentFeeContract", BAccount $ unspecifiedChain 0xDEC1DE02)
        ]

dec1deFilePath :: FilePath
dec1deFilePath = "Decide.sol"

dec1deStateFilePath :: FilePath
dec1deStateFilePath = "DeciderState.sol"

embeddedFiles :: [(FilePath, ByteString)]
embeddedFiles = $(typecheckAndEmbedDir "resources/strato/decider" Nothing)

fileMap :: Map FilePath ByteString
fileMap = Map.fromList embeddedFiles

fileContents :: FilePath -> ByteString
fileContents = fromJust . flip Map.lookup fileMap

dec1deContract :: ByteString
dec1deContract = fileContents dec1deFilePath

dec1deStateContract :: ByteString
dec1deStateContract = fileContents dec1deStateFilePath