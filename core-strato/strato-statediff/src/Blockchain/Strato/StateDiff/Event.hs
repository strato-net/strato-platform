module Blockchain.Strato.StateDiff.Event
    ( StateDiffEvent(..)
    , StateDiffKafkaEvent(..)
    , destructStateDiff
    ) where

import           Data.Aeson
import           Data.Binary
import           Data.Binary.Put                 (putLazyByteString)
import           Data.Map                        (Map)
import qualified Data.Map                        as Map
import           Data.Maybe                      (maybeToList)
import qualified Data.Text                       as T

import           Blockchain.ExtWord              (Word256)
import           Blockchain.SHA
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.StateDiff

data StateDiffEvent = DeletionEvent (Maybe Word256) Address (AccountDiff 'Eventual)
                    | CreationEvent (Maybe Word256) Address (AccountDiff 'Eventual)
                    | UpdateEvent   (Maybe Word256) Address (AccountDiff 'Incremental)

data StateDiffKafkaEvent = Bulk StateDiff | Singleton StateDiffEvent

instance Binary StateDiffEvent where
    get = error "Reading StateDiffEvents is currently unsupported"
    put = putLazyByteString . Data.Aeson.encode

instance ToJSON StateDiffEvent where
    toJSON = \case
            DeletionEvent c a d -> mkObject "deletedAccounts" c a d
            CreationEvent c a d -> mkObject "createdAccounts" c a d
            UpdateEvent   c a d -> mkObject "updatedAccounts" c a d
        where mkObject :: (ToJSON (AccountDiff a)) => T.Text -> Maybe Word256 -> Address -> AccountDiff a -> Value
              mkObject key cid address diff = object $ [ key .= object [ address2String address .= toJSON diff ] ]
                                                    ++ maybeToList (("chainId" .=) <$> cid)

              address2String :: Address -> T.Text
              address2String address = let (String t) = toJSON address in t

instance ToJSON StateDiffKafkaEvent where
    toJSON (Bulk sd)      = toJSON sd
    toJSON (Singleton de) = toJSON de

-- order is (deleted, created, updated)
destructStateDiff :: (SHA -> Maybe SHA) -> StateDiff -> ([StateDiffEvent], [StateDiffEvent], [StateDiffEvent])
destructStateDiff codeHashToSourceHash StateDiff{..} = (deletedAccounts', createdAccounts', updatedAccounts')
    where deletedAccounts' = transform (DeletionEvent chainId) deletedAccounts
          createdAccounts' = transform (CreationEvent chainId) createdAccounts
          updatedAccounts' = transform (UpdateEvent   chainId) updatedAccounts

          stripCode :: (Address, AccountDiff d) -> (Address, AccountDiff d)
          stripCode (addr, diff) = (addr, diff { code = Nothing })

          addSourceHash :: AccountDiff d -> AccountDiff d
          addSourceHash diff = diff{sourceCodeHash = codeHashToSourceHash (codeHash diff)}

          transform :: (Address -> AccountDiff d -> StateDiffEvent)
                    -> Map Address (AccountDiff d)
                    -> [StateDiffEvent]
          transform f m = uncurry f . stripCode . fmap addSourceHash <$> Map.toList m
