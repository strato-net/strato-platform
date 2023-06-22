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


module           Blockchain.Data.Snapshot ( Snapshot(..), AddressState''(..), emptySnapshot ) where

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

data Snapshot = Snapshot {
    blockHeaders          :: [BlockHeader],
    fromStateroot         :: StateRoot,
    fromBlockNumber       :: Integer,
    stateDBLeaves         :: [(B.ByteString, Val)],
    addressStateLeaves    :: [(Account, AddressState'')]
} deriving (Eq, Show, Generic, NFData)

deriving instance Data Snapshot

deriving instance Data AddressState''

emptySnapshot :: Snapshot
emptySnapshot = 
    Snapshot {
        blockHeaders = [],
        fromStateroot = StateRoot B.empty,
        fromBlockNumber = 0,
        stateDBLeaves = [],
        addressStateLeaves = []
    }

instance Arbitrary Snapshot where
    arbitrary = oneof [ return $ Snapshot {
                    blockHeaders = [],
                    fromStateroot = StateRoot B.empty,
                    fromBlockNumber = 0,
                    stateDBLeaves = [],
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
        stateDBLeaves = sdbl,
        addressStateLeaves = asl
    } = RLPArray [(RLPArray $ rlpEncode <$> bh), rlpEncode sr, rlpEncode bn, (RLPArray $ rlpEncode <$> sdbl), (RLPArray $ rlpEncode <$> asl)]

    rlpDecode (RLPArray [RLPArray a, b, c, RLPArray d, RLPArray e]) = 
        Snapshot (rlpDecode <$> a) (rlpDecode b) (rlpDecode c) (rlpDecode <$> d)  (rlpDecode <$> e)

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
                    addressStateCodeHash        :: CodePtr,
                    addressStateChainId         :: Maybe Word256
    } deriving (Eq, Generic, Read, Show)

instance NFData AddressState''

instance Format AddressState'' where
    format a =
        CL.blue "AddressState" ++
        tab'("\nnonce: " ++ showHex (addressStateNonce a) "" ++
            "\nbalance: " ++ show (toInteger $ addressStateBalance a) ++
            "\ncontractRoot: " ++ format (addressStateContractRoot a) ++
            "\ncodeHash: " ++ format (addressStateCodeHash a) ++
            "\nchainId: " ++ (show $ fmap (flip showHex "") (addressStateChainId a)))

instance RLPSerializable AddressState'' where
    rlpEncode a | addressStateBalance a < 0 = error $ "Error in cal to rlpEncode for AddressState: AddressState'' has negative balance: " ++ format a
    rlpEncode a = 
        RLPArray $ [
            rlpEncode $ toInteger $ addressStateNonce a,
            rlpEncode $ toInteger $ addressStateBalance a,
            rlpEncode $ addressStateContractRoot a,
            rlpEncode $ addressStateCodeHash a
        ] ++ (maybeToList . fmap rlpEncode $ addressStateChainId a)

    rlpDecode (RLPArray [n, b, cr, ch, cid]) =
        AddressState'' {
            addressStateNonce = fromInteger $ rlpDecode n,
            addressStateBalance = fromInteger $ rlpDecode b,
            addressStateContractRoot = rlpDecode cr,
            addressStateCodeHash = rlpDecode ch,
            addressStateChainId = Just $ rlpDecode cid
        }
    rlpDecode (RLPArray [n, b, cr, ch]) =
        AddressState'' {
            addressStateNonce = fromInteger $ rlpDecode n,
            addressStateBalance = fromInteger $ rlpDecode b,
            addressStateContractRoot = rlpDecode cr,
            addressStateCodeHash = rlpDecode ch,
            addressStateChainId = Nothing
        }
    rlpDecode x = error $ "Missing case in rlpDecode for AddressState: " ++ show (pretty x)
    
{-- TODO: 
    resolveCodePtr fails when there is a circular reference of code pointers on the same chain
    possible solution is to have a helper function that keeps track of all previously visited codepointers and termiantes if it visits the same one twice (aka cycle detection)
--}