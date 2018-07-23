{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.Sequencer.BinaryInstances() where

import           Data.Binary

import           Blockchain.Data.Address     ()
import qualified Blockchain.Data.DataDefs    as DD
import qualified Blockchain.Data.GenesisInfo as GI
import qualified Blockchain.Data.Transaction as TX
import qualified Blockchain.Data.ChainInfo   as CI
import           Blockchain.Data.TXOrigin    ()
import           GHC.Generics                ()

import           Blockchain.Data.RLP
import           Blockchain.ExtWord          ()
import           Blockchain.SHA              ()

import           Data.Time.Clock             (UTCTime)
import           Data.Time.Clock.POSIX

import           Data.ByteString             ()

utcTimeToInteger :: UTCTime -> Integer
utcTimeToInteger = (round :: POSIXTime -> Integer) . utcTimeToPOSIXSeconds

integerToUtcTime :: Integer -> UTCTime
integerToUtcTime = posixSecondsToUTCTime . fromInteger

-- roundedTimestamp :: UTCTime -> UTCTime
-- roundedTimestamp = integerToUtcTime . utcTimeToInteger

instance Binary TX.Transaction where
    put = put . rlpSerialize . rlpEncode
    get = do
        bs <- get
        return . rlpDecode . rlpDeserialize $ bs

instance Binary DD.BlockData where
    put bd = sequence_ $ map ($ bd) $
        [ put . DD.blockDataParentHash
        , put . DD.blockDataUnclesHash
        , put . DD.blockDataCoinbase
        , put . DD.blockDataStateRoot
        , put . DD.blockDataTransactionsRoot
        , put . DD.blockDataReceiptsRoot
        , put . DD.blockDataLogBloom
        , put . DD.blockDataDifficulty
        , put . DD.blockDataNumber
        , put . DD.blockDataGasLimit
        , put . DD.blockDataGasUsed
        , put . utcTimeToInteger . DD.blockDataTimestamp
        , put . DD.blockDataExtraData
        , put . DD.blockDataNonce
        , put . DD.blockDataMixHash
        ]
    get = do
        parentHash       <- get
        unclesHash       <- get
        coinbase         <- get
        stateRoot        <- get
        transactionsRoot <- get
        receiptsRoot     <- get
        logBloom         <- get
        difficulty       <- get
        number           <- get
        gasLimit         <- get
        gasUsed          <- get
        timestamp        <- integerToUtcTime <$> get
        extraData        <- get
        nonce            <- get
        mixHash          <- get
        return $ DD.BlockData parentHash unclesHash coinbase
            stateRoot transactionsRoot receiptsRoot logBloom
            difficulty number gasLimit gasUsed timestamp extraData
            nonce mixHash

instance Binary CI.ChainInfo where
    put gi = sequence_ $ map ($ gi) $
        [ put. CI.chainLabel
        , put. CI.addRule
        , put. CI.removeRule
        , put. CI.members
        , put. CI.accountBalance
        ]
    get = do
        chainLabel      <- get
        addRule         <- get
        removeRule      <- get
        members         <- get
        accountBalance  <- get
        return $ CI.ChainInfo chainLabel addRule removeRule members accountBalance

instance Binary GI.CodeInfo where
  put (GI.CodeInfo bs s1 s2) = put bs >> put s1 >> put s2
  get = GI.CodeInfo <$> get <*> get <*> get

instance Binary GI.AccountInfo where
  put (GI.NonContract a n) = putWord8 0 >> put a >> put n
  put (GI.ContractNoStorage a n s) = putWord8 1 >> put a >> put n >> put s
  put (GI.ContractWithStorage a n s ws) = putWord8 2 >> put a >> put n >> put s >> put ws
  get = do
    w8 <- getWord8
    case w8 of
      0 -> GI.NonContract <$> get <*> get
      1 -> GI.ContractNoStorage <$> get <*> get <*> get
      2 -> GI.ContractWithStorage <$> get <*> get <*> get <*> get
      n -> error $ "Binary GI.AccountInfo: Expected 0, 1, or 2, got: " ++ show n
