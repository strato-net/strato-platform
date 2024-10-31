{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Blockstanbul.BenchmarkLib
  ( benchContext,
    makeBlock,
    makeBlockWithTransactions,
    oneTX,
  )
where

import Blockchain.Blockstanbul
import Blockchain.Data.Block
import Blockchain.Data.Json
import Blockchain.Data.TransactionDef
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Code
import Data.Aeson
import Data.Bits
import qualified Data.ByteString as BS

eitherGenesis :: Either String [Block]
eitherGenesis = map bPrimeToB <$> (eitherDecode "[{\"blockUncles\":[],\"receiptTransactions\":[],\"blockData\":{\"logBloom\":\"00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000\",\"extraData\":\"\",\"gasUsed\":0,\"gasLimit\":3141592,\"unclesHash\":\"1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347\",\"mixHash\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"receiptsRoot\":\"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421\",\"number\":0,\"difficulty\":131072,\"timestamp\":\"1970-01-01T00:00:00.000Z\",\"coinbase\":{\"orgName\":\"BlockApps\",\"orgUnit\":\"Engineering\",\"commonName\":\"Admin\",\"access\":true},\"parentHash\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"nonce\":42,\"stateRoot\":\"9178d0f23c965d81f0834a4c72c6253ce6830f4022b1359aaebfc1ecba442d4e\",\"transactionsRoot\":\"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421\"}, \"next\": \"/\"}]" :: Either String [Block'])

genesisBlock :: Block
genesisBlock = case eitherGenesis of
  Left err -> error err
  Right [] -> error "no block"
  Right (b : _) -> b

oneTX :: Int -> Transaction
oneTX size =
  ContractCreationTX
    { transactionNonce = 0,
      transactionGasPrice = 0,
      transactionGasLimit = 1,
      transactionValue = 0,
      transactionInit = Code {codeBytes = BS.replicate size 0xca},
      transactionChainId = Nothing,
      transactionR = 1 `shiftL` 200,
      transactionS = 1 `shiftL` 133,
      transactionV = 27,
      transactionMetadata = Nothing
    }

--benchPrivateKey :: PrivateKey
--benchPrivateKey = fromMaybe (error "could not import private key") (importPrivateKey (LabeledError.b16Decode "benchPrivateKey" $ C8.pack $ "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"))

benchChainMember :: ChainMemberParsedSet
benchChainMember = CommonName "BlockApps" "Engineering" "Admin" True

benchContext :: BlockstanbulContext
benchContext = newContext "" (Checkpoint (View 200 40) [benchValidator]) Nothing True (Just benchChainMember)
    where benchValidator = chainMemberParsedSetToValidator benchChainMember

makeBlock :: Int -> Int -> Block
makeBlock txcount txsize =
  setBlockNo
    41
    genesisBlock {blockReceiptTransactions = replicate txcount (oneTX txsize)}

makeBlockWithTransactions :: [Transaction] -> Block
makeBlockWithTransactions txs =
  genesisBlock {blockReceiptTransactions = txs}
