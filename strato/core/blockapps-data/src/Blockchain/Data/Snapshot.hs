{-# LANGUAGE DeriveFunctor        #-}
{-# LANGUAGE DeriveGeneric        #-}
{-# LANGUAGE LambdaCase           #-}
{-# LANGUAGE TemplateHaskell      #-}
{-# LANGUAGE RecordWildCards      #-}
{-# LANGUAGE DeriveAnyClass       #-}
{-# LANGUAGE StandaloneDeriving   #-}
{-# LANGUAGE DeriveDataTypeable   #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}


module           Blockchain.Data.Snapshot ( 
    Snapshot(..), 
    AddressState''(..), 
    emptySnapshot, 
    RedisSnapshot(..),
    SnapshotPayload ) where

import           Control.DeepSeq
import           Data.Binary
import qualified Data.ByteString                        as B
import           Data.Data
import           Data.Maybe                             (maybeToList)

import           Blockchain.Data.BlockHeader
import           Blockchain.Data.RLP
import           Blockchain.Database.MerklePatricia
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.ExtendedWord
import           GHC.Generics
import           Numeric

import           Test.QuickCheck
import qualified Text.Colors                            as CL
import           Text.Format
import           Text.PrettyPrint.ANSI.Leijen       hiding ((<$>))
import           Text.Tools

type SnapshotPayload = ([BlockHeader], RedisSnapshot)

data RedisSnapshot = RedisSnapshot {
    partNumber            :: Integer,
    totalParts            :: Integer,
    fromBlock             :: Integer,
    snapshotBytes         :: B.ByteString
} deriving (Eq, Show, Generic, NFData)

deriving instance Data RedisSnapshot
deriving instance Binary RedisSnapshot

instance RLPSerializable RedisSnapshot where
    rlpEncode RedisSnapshot {
        partNumber = pn,
        totalParts = tp,
        fromBlock  = fb,
        snapshotBytes = sb
    } = RLPArray [rlpEncode pn, rlpEncode tp, rlpEncode fb, rlpEncode sb]

    rlpDecode (RLPArray [a, b, c, d]) = 
        RedisSnapshot (rlpDecode a) (rlpDecode b) (rlpDecode c) (rlpDecode d)

    rlpDecode (RLPArray arr) = error ("rlpDecode for RedisSnapshot called on object with wrong amount of data, length arr = " ++ show arr)
    rlpDecode x = error ("rlpDecode for RedisSnapshot... something went massively wrong: " ++ show x)

instance Arbitrary RedisSnapshot where
    arbitrary = do
        pn  <- arbitrary     
        tbp <- arbitrary  
        fbn <- arbitrary 
        oneof [ return $ RedisSnapshot {
                    partNumber= pn,
                    totalParts = tbp,
                    fromBlock = fbn,
                    snapshotBytes = B.empty
                }]


data Snapshot = Snapshot {
    blockHeaders          :: [BlockHeader],
    fromStateroot         :: StateRoot,
    fromBlockNumber       :: Integer,
    addressStateLeaves    :: [(Account, AddressState'')]
} deriving (Eq, Show, Generic, NFData)

deriving instance Data Snapshot

emptySnapshot :: Snapshot
emptySnapshot = 
    Snapshot {
        blockHeaders = [],
        fromStateroot = StateRoot B.empty,
        fromBlockNumber = 0,
        addressStateLeaves = []
    }

instance Arbitrary Snapshot where
    arbitrary = oneof [ return $ Snapshot {
                    blockHeaders = [],
                    fromStateroot = StateRoot B.empty,
                    fromBlockNumber = 0,
                    addressStateLeaves = []
                }]

instance Binary Snapshot where
    put = put . rlpSerialize . rlpEncode
    get = (rlpDecode . rlpDeserialize) <$> get

instance RLPSerializable Snapshot where
    rlpEncode Snapshot {
        blockHeaders = bh,
        fromStateroot = sr,
        fromBlockNumber = bn,
        addressStateLeaves = asl
    } = RLPArray [(RLPArray $ rlpEncode <$> bh), rlpEncode sr, rlpEncode bn, (RLPArray $ rlpEncode <$> asl)]

    rlpDecode (RLPArray [RLPArray a, b, c, RLPArray d]) = 
        Snapshot (rlpDecode <$> a) (rlpDecode b) (rlpDecode c) (rlpDecode <$> d)

    rlpDecode (RLPArray arr) = error ("rlpDecode for Snapshot called on object with wrong amount of data, length arr = " ++ show arr)
    rlpDecode x = error ("rlpDecode for Snapshot... something went massively wrong: " ++ show x)

instance RLPSerializable RLPObject where
    rlpEncode x     = x
    rlpDecode bytes = bytes

-- Cannot just import AddressState'' because that creates a circular dependency
data AddressState'' =
    AddressState''{ addressStateNonce           :: Integer,
                    addressStateBalance         :: Integer,
                    addressStateContractRoot    :: StateRoot,
                    addressStateStorageKeyVals  :: [(B.ByteString, B.ByteString)],
                    addressStateCode            :: B.ByteString,
                    addressStateCodeHash        :: CodePtr,
                    addressStateChainId         :: Maybe Word256
    } deriving (Eq, Generic, Read, Show)

instance NFData AddressState''

deriving instance Data AddressState''

instance Format AddressState'' where
    format a =
        CL.blue "AddressState" ++
        tab'("\nnonce: " ++ showHex (addressStateNonce a) "" ++
            "\nbalance: " ++ show (toInteger $ addressStateBalance a) ++
            "\ncontractRoot: " ++ format (addressStateContractRoot a) ++
            "\nstorageKeyVals: " ++ format (addressStateStorageKeyVals a) ++  
            "\ncode: " ++ format (addressStateCode a) ++
            "\ncodeHash: " ++ format (addressStateCodeHash a) ++
            "\nchainId: " ++ (show $ fmap (flip showHex "") (addressStateChainId a)))

instance RLPSerializable AddressState'' where
    rlpEncode a | addressStateBalance a < 0 = error $ "Error in cal to rlpEncode for AddressState: AddressState'' has negative balance: " ++ format a
    rlpEncode a = 
        RLPArray $ [
            rlpEncode $ toInteger $ addressStateNonce a,
            rlpEncode $ toInteger $ addressStateBalance a,
            rlpEncode $ addressStateContractRoot a,
            RLPArray $ rlpEncode <$> addressStateStorageKeyVals a,
            rlpEncode $ addressStateCode a,
            rlpEncode $ addressStateCodeHash a
        ] ++ (maybeToList . fmap rlpEncode $ addressStateChainId a)

    rlpDecode (RLPArray [n, b, cr, kv, c, ch, cid]) =
        AddressState'' {
            addressStateNonce = fromInteger $ rlpDecode n,
            addressStateBalance = fromInteger $ rlpDecode b,
            addressStateContractRoot = rlpDecode cr,
            addressStateStorageKeyVals = rlpDecode kv,
            addressStateCode = rlpDecode c,
            addressStateCodeHash = rlpDecode ch,
            addressStateChainId = Just $ rlpDecode cid
        }
    rlpDecode (RLPArray [n, b, cr, kv, c, ch]) =
        AddressState'' {
            addressStateNonce = fromInteger $ rlpDecode n,
            addressStateBalance = fromInteger $ rlpDecode b,
            addressStateContractRoot = rlpDecode cr,
            addressStateStorageKeyVals = rlpDecode kv,
            addressStateCode = rlpDecode c,
            addressStateCodeHash = rlpDecode ch,
            addressStateChainId = Nothing
        }
    rlpDecode x = error $ "Missing case in rlpDecode for AddressState: " ++ show (pretty x)
    
{-- TODO: 
    resolveCodePtr fails when there is a circular reference of code pointers on the same chain
    possible solution is to have a helper function that keeps track of all previously visited codepointers and termiantes if it visits the same one twice (aka cycle detection)
--}