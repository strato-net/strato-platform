{-# LANGUAGE BangPatterns               #-}
{-# LANGUAGE DeriveAnyClass             #-}
{-# LANGUAGE DeriveGeneric              #-}
{-# LANGUAGE DerivingStrategies         #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE ScopedTypeVariables        #-}
{-# LANGUAGE TypeApplications           #-}
{-# LANGUAGE TypeOperators              #-}

module Blockchain.DB.SubscriptionsDB
  ( SubscriptionsRoot(..)
  , bootstrapSubscriptionsDB
  , putBlockHeaderInSubscriptionsDB
  , migrateBlockHeaderSubscriptions
  , getSubscriptionsRootForBlock
  , getSubscriptionsBlockHashInfo
  , putSubscriptionsRootForBlock
  , getSubscriptionsList
  , putSubscriptionsList
  , deleteSubscriptionsList
  , getSubscriptionsListLength
  , getSubscriptionAtIndex
  , getIndexOfSubscription
  , traverseSubscriptionList
  , subscribe
  , unsubscribe
  ) where

import           Control.DeepSeq
import           Control.Monad.Change.Alter           hiding (lookup)
import           Control.Monad.Change.Modify

import           Data.Maybe                           (catMaybes, fromMaybe)
import qualified Data.NibbleString                    as N
import           Data.Text                            (Text)
import           Data.Traversable                     (for)

import qualified Blockchain.Database.MerklePatricia   as MP
import           Blockchain.Data.RLP

import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.Keccak256    (Keccak256, keccak256ToByteString, rlpHash, zeroHash)

import           GHC.Generics
import           Text.Format



{-
|-------------------------------------------------------------------------------|
|                          The Subscriptions DB                                 |
|-------------------------------------------------------------------------------|
| First, each (Account, Event name) pair will have a subscription root, where   |
| the keys are the indices of the subscriptions, and the values are the         |
| (Account, Function name) pair of the subscription:                            |
|                  subscription root                                            |
|                          /\                                                   |
|                         /  \                                                  |
|                        /\  /\                                                 |
|                    subscriptions                                              |
|                                                                               |
| Next, each subscription will have an index trie, where the keys are the hash  |
| of the (Account, Function name) pair of the subscription, and the value is    |
| the index of the subscription within the events subscriptions list. This trie |
| is used to unsubscribe from an event in O(1) time.                            |
|                      index root                                               |
|                          /\                                                   |
|                         /  \                                                  |
|                        /\  /\                                                 |
|                       indices                                                 |
|                                                                               |
| Then, each event definition will have an entry in the subscriptions trie,     |
| where the keys are the (Account, Event name) pair of the event, and the       |
| values are the triple of the event's subscription root, index root, and       |
| length of the subscriptions list. When an event is fired, the VM will load    |
| the subscription root and length from this trie, read the first <length>      |
| entries from the subscription trie, and run the callbacks defined at the      |
| (Account, Function name) pair of each subscription.                           |
|                  subscriptions root                                           |
|                          /\                                                   |
|                         /  \                                                  |
|                        /\  /\                                                 |
|             (subscription root, index root, length)                           |
| Finally, to keep track of subscriptions roots across blocks, we'll store the  |
| subscriptions roots in a trie, keyed by block hash:                           |
|            subscriptions block hash root                                      |
|                          /\                                                   |
|                         /  \                                                  |
|                        /\  /\                                                 |
|       (block hash, (parent hash, subscriptions root))                         |
|-------------------------------------------------------------------------------|
-}

type EventName = Text
type FunctionName = Text

newtype SubscriptionsRoot = SubscriptionsRoot { unSubscriptionsRoot :: MP.StateRoot }
  deriving (Eq, Ord, Show, Generic)
  deriving newtype (Format, NFData)

newtype Subscription = Subscription { unSubscription :: (Account, FunctionName) }
  deriving (Eq, Ord, Show, Generic)
  deriving newtype (Format, NFData)

instance RLPSerializable Subscription where
  rlpEncode (Subscription (acct, fName)) = RLPArray [rlpEncode acct, rlpEncode fName]
  rlpDecode (RLPArray [acct, fName]) = Subscription (rlpDecode acct, rlpDecode fName)
  rlpDecode o = error ("Error in rlpDecode for Subscription: bad RLPObject: " ++ show o)

newtype EventSource = EventSource { unEventSource :: (Account, EventName) } -- could be a better name?
  deriving (Eq, Ord, Show, Generic)
  deriving newtype (Format, NFData)

instance RLPSerializable EventSource where
  rlpEncode (EventSource (acct, eName)) = RLPArray [rlpEncode acct, rlpEncode eName]
  rlpDecode (RLPArray [acct, eName]) = EventSource (rlpDecode acct, rlpDecode eName)
  rlpDecode o = error ("Error in rlpDecode for EventSource: bad RLPObject: " ++ show o)

data SubscriptionsList = SubscriptionsList
  { subscriptionsTrie       :: !MP.StateRoot
  , indicesTrie             :: !MP.StateRoot
  , subscriptionsListLength :: !Integer
  }
  deriving (Eq, Ord, Show, Generic, NFData)

instance Format SubscriptionsList where
  format (SubscriptionsList s i l) = concat
    [ "SubscriptionsList ("
    , format s
    , ", "
    , format i
    , ", "
    , show l
    , ")"
    ]

instance RLPSerializable SubscriptionsList where
  rlpEncode (SubscriptionsList s i l) = RLPArray [rlpEncode s, rlpEncode i, rlpEncode l]
  rlpDecode (RLPArray [s, i, l]) = SubscriptionsList (rlpDecode s) (rlpDecode i) (rlpDecode l)
  rlpDecode o = error ("Error in rlpDecode for SubscriptionsList: bad RLPObject: " ++ show o)

emptySubscriptionsList :: SubscriptionsList
emptySubscriptionsList = SubscriptionsList MP.emptyTriePtr MP.emptyTriePtr 0

toMPKey :: RLPSerializable a => a -> N.NibbleString
toMPKey = N.EvenNibbleString . keccak256ToByteString . rlpHash

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

bootstrapSubscriptionsDB :: ( Modifiable SubscriptionsRoot m
                            , (MP.StateRoot `Alters` MP.NodeData) m
                            )
                         => Keccak256 -> m SubscriptionsRoot
bootstrapSubscriptionsDB genesisHash = do
  putSubscriptionsRootForBlock genesisHash zeroHash MP.emptyTriePtr
  get (Proxy @SubscriptionsRoot)

putBlockHeaderInSubscriptionsDB :: ( BlockHeaderLike h
                                   , Modifiable SubscriptionsRoot m
                                   , (MP.StateRoot `Alters` MP.NodeData) m
                                   )
                                => h -> m ()
putBlockHeaderInSubscriptionsDB b = do
  let p = blockHeaderParentHash b
      h = blockHeaderHash b
  putBlockHashInSubscriptionsDB p h

putBlockHashInSubscriptionsDB :: ( Modifiable SubscriptionsRoot m
                                 , (MP.StateRoot `Alters` MP.NodeData) m
                                 )
                              => Keccak256 -> Keccak256 -> m ()
putBlockHashInSubscriptionsDB p h =
  putSubscriptionsRootForBlock h p =<< fromMaybe MP.emptyTriePtr <$> getSubscriptionsRootForBlock p

migrateBlockHeaderSubscriptions :: ( BlockHeaderLike h
                                   , Modifiable SubscriptionsRoot m
                                   , (MP.StateRoot `Alters` MP.NodeData) m
                                   )
                                => h -> Keccak256 -> m ()
migrateBlockHeaderSubscriptions oldBD newH = do
  let oldH = blockHeaderHash oldBD
      oldP = blockHeaderParentHash oldBD
  mExistingSubscriptionsRoot <- getSubscriptionsRootForBlock oldH
  case mExistingSubscriptionsRoot of
    Nothing -> putBlockHeaderInSubscriptionsDB oldBD >> migrateBlockHeaderSubscriptions oldBD newH
    Just ssr -> putSubscriptionsRootForBlock newH oldP ssr

getSubscriptionsRootForBlock :: ( Modifiable SubscriptionsRoot m
                                , (MP.StateRoot `Alters` MP.NodeData) m
                                )
                             => Keccak256 -> m (Maybe MP.StateRoot)
getSubscriptionsRootForBlock = fmap (fmap snd) . getSubscriptionsBlockHashInfo

getSubscriptionsBlockHashInfo :: ( Modifiable SubscriptionsRoot m
                                 , (MP.StateRoot `Alters` MP.NodeData) m
                                 )
                              => Keccak256 -> m (Maybe (Keccak256, MP.StateRoot))
getSubscriptionsBlockHashInfo h = do
  ssr <- unSubscriptionsRoot <$> get Proxy
  getkv ssr (N.EvenNibbleString $ keccak256ToByteString h)

putSubscriptionsRootForBlock :: ( Modifiable SubscriptionsRoot m
                                , (MP.StateRoot `Alters` MP.NodeData) m
                                )
                             => Keccak256 -> Keccak256 -> MP.StateRoot -> m ()
putSubscriptionsRootForBlock h parentHash sr = do
  ssr <- unSubscriptionsRoot <$> get Proxy
  newSubscriptionsRoot <- putkv ssr (N.EvenNibbleString $ keccak256ToByteString h) (parentHash, sr)
  put Proxy $ SubscriptionsRoot newSubscriptionsRoot

getSubscriptionsList :: ( Modifiable SubscriptionsRoot m
                        , (MP.StateRoot `Alters` MP.NodeData) m
                        )
                     => EventSource -> Keccak256 -> m SubscriptionsList
getSubscriptionsList evSource bh = go bh
  where go bHash = do
          mSubsRoot <- getSubscriptionsBlockHashInfo bHash
          fmap (fromMaybe emptySubscriptionsList) . for mSubsRoot $ \(parentHash, subsRoot) -> do
            mSubRoot <- getkv subsRoot (toMPKey evSource)
            case mSubRoot of
              Just sl -> pure sl
              Nothing -> do
                subList' <- if parentHash == zeroHash
                  then pure emptySubscriptionsList
                  else go parentHash
                putSubscriptionsList evSource bHash subList'
                pure subList'

putSubscriptionsList :: ( Modifiable SubscriptionsRoot m
                     , (MP.StateRoot `Alters` MP.NodeData) m
                     )
                  => EventSource -> Keccak256 -> SubscriptionsList -> m ()
putSubscriptionsList evSource bHash subList = do
  mSubsRoot <- getSubscriptionsBlockHashInfo bHash
  case mSubsRoot of
    Nothing -> pure ()
    Just (parentHash, subsRoot) -> do
      newSubsRoot <- putkv subsRoot (toMPKey evSource) subList
      putSubscriptionsRootForBlock bHash parentHash newSubsRoot

deleteSubscriptionsList :: ( Modifiable SubscriptionsRoot m
                           , (MP.StateRoot `Alters` MP.NodeData) m
                           )
                        => EventSource -> Keccak256 -> m ()
deleteSubscriptionsList evSource bHash = do
  mSubsRoot <- getSubscriptionsBlockHashInfo bHash
  case mSubsRoot of
    Nothing -> pure ()
    Just (parentHash, subsRoot) -> do
      newSubsRoot <- MP.deleteKey subsRoot (toMPKey evSource)
      putSubscriptionsRootForBlock bHash parentHash newSubsRoot

getSubscriptionsListLength :: ( Modifiable SubscriptionsRoot m
                              , (MP.StateRoot `Alters` MP.NodeData) m
                              )
                           => EventSource -> Keccak256 -> m Integer
getSubscriptionsListLength evSource bh = do
  ~(SubscriptionsList _ _ len) <- getSubscriptionsList evSource bh
  pure len

getSubscriptionAtIndex :: ( Modifiable SubscriptionsRoot m
                          , (MP.StateRoot `Alters` MP.NodeData) m
                          )
                       => EventSource -> Integer -> Keccak256 -> m (Maybe Subscription)
getSubscriptionAtIndex evSource index bh = do
  ~(SubscriptionsList subTrie _ _) <- getSubscriptionsList evSource bh
  getkv subTrie (toMPKey index)

getIndexOfSubscription :: ( Modifiable SubscriptionsRoot m
                          , (MP.StateRoot `Alters` MP.NodeData) m
                          )
                       => EventSource -> Subscription -> Keccak256 -> m (Maybe Integer)
getIndexOfSubscription evSource subscription bh = do
  ~(SubscriptionsList _ iTrie _) <- getSubscriptionsList evSource bh
  getkv iTrie (toMPKey subscription)

traverseSubscriptionList :: ( Modifiable SubscriptionsRoot m
                            , (MP.StateRoot `Alters` MP.NodeData) m
                            )
                         => EventSource -> Keccak256 -> (Subscription -> m a) -> m [a]
traverseSubscriptionList evSource bh f = do
  ~(SubscriptionsList subTrie _ len) <- getSubscriptionsList evSource bh
  fmap catMaybes . for [0..len-1] $ \index -> do
    mSubscription <- getkv subTrie (toMPKey index)
    traverse f mSubscription

subscribe :: ( Modifiable SubscriptionsRoot m
             , (MP.StateRoot `Alters` MP.NodeData) m
             )
          => EventSource -> Subscription -> Keccak256 -> m ()
subscribe evSource subscription bh = do
  ~(SubscriptionsList subTrie iTrie len) <- getSubscriptionsList evSource bh
  mIndex <- getkv iTrie (toMPKey subscription)
  case mIndex of
    Just (_ :: Integer) -> pure ()
    Nothing -> do
      newSubTrie <- putkv subTrie (toMPKey len) subscription
      newIndexTrie <- putkv iTrie (toMPKey subscription) len
      putSubscriptionsList evSource bh $ SubscriptionsList newSubTrie newIndexTrie (len + 1)

unsubscribe :: ( Modifiable SubscriptionsRoot m
               , (MP.StateRoot `Alters` MP.NodeData) m
               )
            => EventSource -> Subscription -> Keccak256 -> m ()
unsubscribe evSource subscription bh = do
  ~(SubscriptionsList subTrie iTrie len) <- getSubscriptionsList evSource bh
  mIndex <- getkv iTrie (toMPKey subscription)
  case mIndex of
    Nothing -> pure ()
    Just (index :: Integer) -> do
      newSubTrie <- MP.deleteKey subTrie (toMPKey index)
      newIndexTrie <- MP.deleteKey iTrie (toMPKey subscription)
      putSubscriptionsList evSource bh $ SubscriptionsList newSubTrie newIndexTrie len