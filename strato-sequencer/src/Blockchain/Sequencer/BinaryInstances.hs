{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.Sequencer.BinaryInstances() where

import           Data.Binary

import           Blockchain.Data.Address     ()
import qualified Blockchain.Data.DataDefs    as DD
import qualified Blockchain.Data.Transaction as TX
import           Blockchain.Data.TXOrigin    ()
import           GHC.Generics                ()

import           Blockchain.Data.RLP
import           Blockchain.ExtWord          ()
import           Blockchain.SHA              ()

import           Data.Time.Clock.POSIX

import           Data.ByteString             ()

instance Binary TX.Transaction where
    put = put . rlpSerialize . rlpEncode
    get = do
        bs <- get
        return . rlpDecode . rlpDeserialize $ bs

instance Binary DD.BlockData where
    put bd = sequence_ $ map ($ bd)
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
        , put . (round :: POSIXTime -> Integer) . utcTimeToPOSIXSeconds . DD.blockDataTimestamp
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
        timestamp        <- (posixSecondsToUTCTime . fromInteger) <$> get
        extraData        <- get
        nonce            <- get
        mixHash          <- get
        return $ DD.BlockData parentHash unclesHash coinbase
            stateRoot transactionsRoot receiptsRoot logBloom
            difficulty number gasLimit gasUsed timestamp extraData
            nonce mixHash


