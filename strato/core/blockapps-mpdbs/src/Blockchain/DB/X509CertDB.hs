{-# LANGUAGE ConstraintKinds            #-}
{-# LANGUAGE DeriveGeneric              #-}
{-# LANGUAGE DerivingStrategies         #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE ScopedTypeVariables        #-}
{-# LANGUAGE TypeApplications           #-}
{-# LANGUAGE TypeOperators              #-}

module Blockchain.DB.X509CertDB
  ( 
    HasX509CertDB
  , HasMemCertDB(..)
  , CertModification(..)
  , getCertTxMap
  , getCertMaybe
  , putCert
  , flushMemCertTxToBlockDB
  , flushMemCertDB
  , deleteCert
  , certExists
  , CertRoot(..)
  , bootstrapCertDB
  , putBlockHeaderInCertDB
  , putBlockHashInCertDB
  , migrateBlockHeaderCertDB
  , getCertRoot
  , getX509Cert
  , putX509Cert
  , deleteX509Cert
  , X509Certificate(..)
  , Subject(..)
  , certToBytes
  , bsToCert
  , getCertSubject
  , getCertIssuer
  , rootCert
  , rootPubKey
  , pubToBytes
  , bsToPub
  , verifyCert
  , verifyCertSignedBy
  , verifyBlockApps
  , getParentUserAddress
  , getCertValidity
  , dateTimeToString
  ) where

import           Control.DeepSeq
import           Control.Monad                        (join)
import           Control.Monad.Change.Alter           hiding (lookup)
import           Control.Monad.Change.Modify

import qualified Data.ByteString                      as B
import           Data.Foldable                        (for_)
import qualified Data.Map.Strict                      as M
import           Data.Maybe                           (fromMaybe, isJust)
import qualified Data.NibbleString                    as N
import           Data.Traversable                     (for)

import qualified Blockchain.Database.MerklePatricia   as MP
import           Blockchain.Data.RLP

import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.ExtendedWord (word160ToBytes)
import           Blockchain.Strato.Model.Keccak256    (Keccak256, keccak256ToByteString)
import           BlockApps.X509

import           GHC.Generics
import           Text.Format



type HasX509CertDB m = (Address `Alters` X509Certificate) m

data CertModification = Modification X509Certificate | Deletion deriving (Show, Eq, Generic)

instance NFData CertModification

class Monad m => HasMemCertDB m where
  getCertTxDBMap    :: m (M.Map Address CertModification)
  putCertTxDBMap    :: M.Map Address CertModification -> m ()
  getCertBlockDBMap :: m (M.Map Address CertModification)
  putCertBlockDBMap :: M.Map Address CertModification -> m ()

getCertTxMap :: HasMemCertDB m => m (M.Map Address X509Certificate)
getCertTxMap = M.map fromMod . M.filter modifications <$> getCertTxDBMap
  where modifications (Modification _) = True
        modifications _                = False
        fromMod (Modification x) = x
        fromMod _ = error "getCertTxMap: Found a Deletion after filtering them out"

getCertMaybe :: ( HasMemCertDB m
                , Modifiable CertRoot m
                , (MP.StateRoot `Alters` MP.NodeData) m
                )
             => Address -> Keccak256 -> m (Maybe X509Certificate)
getCertMaybe addr bHash = do
  theMap <- getCertTxDBMap
  case M.lookup addr theMap of
    Just (Modification cert) -> return $ Just cert
    Just Deletion            -> return Nothing
    Nothing                  -> do
      theBMap <- getCertBlockDBMap
      case M.lookup addr theBMap of
        Just (Modification cert) -> return $ Just cert
        Just Deletion            -> return Nothing
        Nothing                  -> getX509Cert addr bHash

putCert :: HasMemCertDB m => Address -> X509Certificate -> m ()
putCert addr cert = do
  theMap <- getCertTxDBMap
  putCertTxDBMap (M.insert addr (Modification cert) theMap)

flushMemCertTxToBlockDB :: HasMemCertDB m => m ()
flushMemCertTxToBlockDB = do
  txMap <- getCertTxDBMap
  blkMap <- getCertBlockDBMap
  putCertBlockDBMap $ txMap `M.union` blkMap
  putCertTxDBMap M.empty

flushMemCertDB :: ( HasMemCertDB m
                  , Modifiable CertRoot m
                  , (MP.StateRoot `Alters` MP.NodeData) m 
                  )
               => Keccak256 -> m ()
flushMemCertDB bHash = do
  flushMemCertTxToBlockDB
  theMap <- getCertBlockDBMap
  for_ (M.toList theMap) $ \(addr, modification) ->
    case modification of
      Modification cert -> putX509Cert addr bHash cert
      Deletion          -> deleteX509Cert addr bHash
  putCertBlockDBMap M.empty

deleteCert :: HasMemCertDB m => Address -> m ()
deleteCert addr = do
  theMap <- getCertTxDBMap
  putCertTxDBMap (M.insert addr Deletion theMap)

certExists :: ( HasMemCertDB m
              , Modifiable CertRoot m
              , (MP.StateRoot `Alters` MP.NodeData) m
              )
           => Address -> Keccak256 -> m Bool
certExists addr bHash = do
  theMap <- getCertTxDBMap
  case M.lookup addr theMap of
    Just (Modification _) -> return True
    Just Deletion         -> return False
    Nothing               -> do
      theBMap <- getCertBlockDBMap
      case M.lookup addr theBMap of
        Just (Modification _) -> return True
        Just Deletion         -> return False
        Nothing               -> isJust <$> getX509Cert addr bHash

newtype CertRoot = CertRoot { unCertRoot :: MP.StateRoot }
  deriving (Eq, Ord, Show, Generic)
  deriving newtype (Format, NFData)

addressToMPKey :: Address -> N.NibbleString
addressToMPKey (Address addr) = N.EvenNibbleString . B.pack $ word160ToBytes addr

getkv :: ( RLPSerializable a
         , (MP.StateRoot `Alters` MP.NodeData) m
         )
      => MP.StateRoot -> N.NibbleString -> m (Maybe a)
getkv sr = fmap (fmap rlpDecode) . MP.getKeyVal sr

putkv :: ( RLPSerializable a
         , (MP.StateRoot `Alters` MP.NodeData) m
         )
      => MP.StateRoot -> N.NibbleString -> a -> m MP.StateRoot
putkv sr k = MP.putKeyVal sr k . rlpEncode

bootstrapCertDB :: ( Modifiable CertRoot m
                   , (MP.StateRoot `Alters` MP.NodeData) m
                   )
                => Keccak256 -> m CertRoot
bootstrapCertDB genesisHash = do
  putCertBlockHashInfo genesisHash MP.emptyTriePtr
  get (Proxy @CertRoot)

putBlockHeaderInCertDB :: ( BlockHeaderLike h
                          , Modifiable CertRoot m
                          , (MP.StateRoot `Alters` MP.NodeData) m
                          )
                       => h -> m ()
putBlockHeaderInCertDB b = do
  let p = blockHeaderParentHash b
      h = blockHeaderHash b
  putBlockHashInCertDB p h

putBlockHashInCertDB :: ( Modifiable CertRoot m
                        , (MP.StateRoot `Alters` MP.NodeData) m
                        )
                     => Keccak256 -> Keccak256 -> m ()
putBlockHashInCertDB p h =
  putCertBlockHashInfo h =<< fromMaybe MP.emptyTriePtr <$> getCertRoot p

migrateBlockHeaderCertDB :: ( BlockHeaderLike h
                            , Modifiable CertRoot m
                            , (MP.StateRoot `Alters` MP.NodeData) m
                            )
                         => h -> Keccak256 -> m ()
migrateBlockHeaderCertDB oldBD newH = do
  let oldH = blockHeaderHash oldBD
  mExistingCertRoot <- getCertRoot oldH
  case mExistingCertRoot of
    Nothing -> putBlockHeaderInCertDB oldBD >> migrateBlockHeaderCertDB oldBD newH
    Just cr -> putCertBlockHashInfo newH cr

getCertRoot :: ( Modifiable CertRoot m
               , (MP.StateRoot `Alters` MP.NodeData) m
               )
            => Keccak256 -> m (Maybe MP.StateRoot)
getCertRoot = getCertBlockHashInfo

getCertBlockHashInfo :: ( Modifiable CertRoot m
                        , (MP.StateRoot `Alters` MP.NodeData) m
                        )
                     => Keccak256 -> m (Maybe MP.StateRoot)
getCertBlockHashInfo h = do
  cr <- unCertRoot <$> get Proxy
  getkv cr (N.EvenNibbleString $ keccak256ToByteString h)

putCertBlockHashInfo :: ( Modifiable CertRoot m
                        , (MP.StateRoot `Alters` MP.NodeData) m
                        )
                     => Keccak256 -> MP.StateRoot -> m ()
putCertBlockHashInfo h sr = do
  cr <- unCertRoot <$> get Proxy
  newCertRoot <- putkv cr (N.EvenNibbleString $ keccak256ToByteString h) sr
  put Proxy $ CertRoot newCertRoot

getX509Cert :: ( Modifiable CertRoot m
               , (MP.StateRoot `Alters` MP.NodeData) m
               )
            => Address -> Keccak256 -> m (Maybe X509Certificate)
getX509Cert addr bHash = do
  mCertRoot <- getCertBlockHashInfo bHash
  fmap join . for mCertRoot $ \certRoot -> do
    getkv certRoot (addressToMPKey addr)

putX509Cert :: ( Modifiable CertRoot m
               , (MP.StateRoot `Alters` MP.NodeData) m
               )
            => Address -> Keccak256 -> X509Certificate -> m ()
putX509Cert addr bHash cert = do
  mCertRoot <- getCertBlockHashInfo bHash
  case mCertRoot of
    Nothing -> pure ()
    Just certRoot -> do
      newCertRoot <- putkv certRoot (addressToMPKey addr) cert
      putCertBlockHashInfo bHash newCertRoot

deleteX509Cert :: ( Modifiable CertRoot m
                  , (MP.StateRoot `Alters` MP.NodeData) m
                  )
               => Address -> Keccak256 -> m ()
deleteX509Cert addr bHash = do
  mCertRoot <- getCertBlockHashInfo bHash
  case mCertRoot of
    Nothing -> pure ()
    Just certRoot -> do
      newCertRoot <- MP.deleteKey certRoot (addressToMPKey addr)
      putCertBlockHashInfo bHash newCertRoot