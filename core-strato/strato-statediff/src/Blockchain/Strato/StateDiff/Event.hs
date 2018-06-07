module Blockchain.Strato.StateDiff.Event
    ( StateDiffEvent(..)
    , StateDiffKafkaEvent(..)
    , destructStateDiff
    ) where

import           Data.Aeson
import           Data.Aeson.Types                (typeMismatch)
import           Data.Binary
import           Data.Binary.Put                 (putLazyByteString)
import qualified Data.HashMap.Strict             as H
import           Data.Map                        (Map)
import qualified Data.Map                        as Map
import qualified Data.Text                       as T

import           Blockchain.Format
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.StateDiff

data StateDiffEvent = DeletionEvent Address (AccountDiff 'Eventual)
                    | CreationEvent Address (AccountDiff 'Eventual)
                    | UpdateEvent   Address (AccountDiff 'Incremental)

data StateDiffKafkaEvent = Bulk StateDiff | Singleton StateDiffEvent

instance Binary StateDiffEvent where
    get = error "Reading StateDiffEvents is currently unsupported"
    put = putLazyByteString . Data.Aeson.encode

instance ToJSON StateDiffEvent where
    toJSON = \case
            DeletionEvent a d -> mkObject "deletedAccounts" a d
            CreationEvent a d -> mkObject "createdAccounts" a d
            UpdateEvent   a d -> mkObject "updatedAccounts" a d
        where mkObject :: (ToJSON (AccountDiff a)) => T.Text -> Address -> AccountDiff a -> Value
              mkObject key address diff = object [ key .= object [ address2String address .= toJSON diff ] ]

              address2String :: Address -> T.Text
              address2String address = let (String t) = toJSON address in t

instance ToJSON StateDiffKafkaEvent where
    toJSON (Bulk sd)      = toJSON sd
    toJSON (Singleton de) = toJSON de

-- order is (deleted, created, updated)
destructStateDiff :: StateDiff -> ([StateDiffEvent], [StateDiffEvent], [StateDiffEvent])
destructStateDiff StateDiff{..} = (deletedAccounts', createdAccounts', updatedAccounts')
    where deletedAccounts' = transform DeletionEvent deletedAccounts
          createdAccounts' = transform CreationEvent createdAccounts
          updatedAccounts' = transform UpdateEvent   updatedAccounts

          stripCode :: (Address, AccountDiff d) -> (Address, AccountDiff d)
          stripCode (addr, diff) = (addr, diff { code = Nothing })

          transform :: (Address -> AccountDiff d -> StateDiffEvent) -> Map Address (AccountDiff d) -> [StateDiffEvent]
          transform f m = uncurry f . stripCode <$> Map.toList m
