{-# LANGUAGE
      OverloadedStrings
    , DataKinds
    , DeriveGeneric
    , FlexibleInstances
    , KindSignatures
    , TypeFamilies
#-}

module Slipstream.Events where

import qualified BlockApps.Ethereum as Eth
import Data.Aeson
import Data.Map (Map)
import qualified Data.Text as T
import qualified BlockApps.Solidity.Value as V

import GHC.Generics

type Word256 = Integer
type Word160 = Integer

type StateRoot=String

newtype SHA = SHA Word256 deriving (Eq, Read, Show, Ord, Generic)

newtype Address = Address Word160 deriving (Show, Eq, Generic, Ord)

-- | Not a type, but a data kind
data Detail = Incremental | Eventual

data StateDiff =
  StateDiff {
    -- blockNumber  :: Integer,
    -- blockHash    :: SHA,
    -- | The 'Eventual value is the initial state of the contract
    createdAccounts :: Maybe (Map String AccountDiff),
    -- | The 'Eventual value is the pre-deletion state of the contract
    deletedAccounts :: Maybe (Map String AccountDiff),
    updatedAccounts :: Maybe (Map String AccountDiff),
    chainId :: Maybe Eth.ChainId
    }
    deriving (Show, Generic)

instance FromJSON StateDiff
instance FromJSON Address
instance FromJSONKey Address
instance FromJSON SHA
instance FromJSON AccountDiff

data Diff a = Diff (Maybe a) (Maybe a) deriving (Show, Generic)

instance (FromJSON a) => FromJSON (Diff a) where
         parseJSON (Object x) = do
           old <- x .:? "oldValue"
           new <- x .:? "newValue"
           return $ Diff old new
         --parseJSON x = typeMismatch "Not an object" x
         parseJSON x = do
           y <- parseJSON x
           return $ Diff Nothing y

data AccountDiff =
  AccountDiff {
    -- | The nonce may not change
    nonce        :: Maybe (Diff Integer),
    -- | The balance may not change
    balance      :: Maybe (Diff Integer),
    -- | Only present for newly created contracts, since the code can never
    -- change
    code         :: Maybe String,
    -- | Since we want to always be able to identify account-type
    --codeHash :: SHA,
    codeHash     :: String,
    sourceCodeHash     :: Maybe (String, String),
    -- | This is necessary for when we commit an AddressStateRef to SQL.
    -- It changes if and only if the storage changes at all
    contractRoot :: Maybe (Diff StateRoot),
    -- | Only the storage keys that change are present in this map.
    --storage :: Map Word256 (Diff Word256)
    storage      :: Map String (Diff String)
    }
    deriving (Generic, Show)

-- data family Diff a (v :: Detail)

data ProcessedContract = ProcessedContract {
  address :: String,
  codehash :: String,
  abi :: String,
  contractName :: String,
  chain :: String,
  contractData :: Map T.Text V.Value
}
