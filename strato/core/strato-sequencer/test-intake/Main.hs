{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

-- | Transaction intake, exercised through the functions that receive loose
-- transactions in a running node:
--
-- * HTTP submission: 'postTransactionWith' and 'postTransactionListWith'
--   (strato-api), given the request body a client posts;
-- * peer gossip: 'handleGossipedTransactions' (strato-p2p), given the
--   transactions of an inbound wire message;
-- * the sequencer: 'transformFullTransactionsWith', where the HTTP stream,
--   strato-ingest and gossip converge.
--
-- @fixtures/legitimate.json@ holds mined upquark transactions, exactly as the
-- node recorded them, covering every envelope combination and every function
-- name in a sample of the chain's history. The malformed transactions are
-- built here and signed with a test key, so only their envelope is wrong. Set
-- @INTAKE_REPLAY_CORPUS@ to a directory of JSON arrays in the fixture's format
-- to replay a larger set.
module Main (main) where

import BlockApps.Logging (MonadLogger (..))
import Blockchain.Context (ActionTimestamp, HasPeerClaims (..), emptyActionTimestamp)
import Blockchain.Data.Control (P2PCNC (..))
import Blockchain.Data.DataDefs (RawTransaction (..))
import qualified Blockchain.Data.TXOrigin as Origin
import Blockchain.Data.Transaction
  ( Transaction (MessageTX, r, s, txVersion, v),
    eip712SignHash,
    getSigVals,
    partialTransactionHash,
    rawTX2TX,
    transactionHash,
    txAndTime2RawTX,
    whoSignedThisTransaction,
  )
import Blockchain.Data.TransactionIntake
import Blockchain.Data.Wire (Message)
import Blockchain.Event (handleGossipedTransactions)
import Blockchain.Model.JsonBlock (RawTransaction' (..))
import Blockchain.Model.SyncState (BestSequencedBlock (..))
import Blockchain.Model.WrappedBlock (IngestTx (..), OutputTx (..))
import Blockchain.Blockstanbul (View (..))
import Blockchain.Sequencer (SeqOutEvent (..), poolWorkIsForView, transformFullTransactionsWith)
import Blockchain.Sequencer.Event (IngestEvent (..), P2pEvent (..), VmTask (..))
import Blockchain.Strato.Discovery.Data.Peer (PPeer)
import Blockchain.Strato.Model.Address (Address (..))
import Blockchain.Strato.Model.Keccak256 (Keccak256, keccak256ToByteString, unsafeCreateKeccak256FromWord256)
import Blockchain.Strato.Model.MicroTime (getCurrentMicrotime)
import Blockchain.Strato.Model.Secp256k1 (importPrivateKey, signMsg)
import Conduit (fuseBoth, runConduit, sinkList, (.|))
import Control.Exception (try)
import Control.Monad (forM, forM_, unless, when)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.IO.Class (MonadIO, liftIO)
import Control.Monad.Reader (ReaderT, ask, asks, runReaderT)
import Data.Aeson (FromJSON (..), eitherDecodeFileStrict', withObject, (.:))
import qualified Data.ByteString as B
import Data.Default (def)
import Data.IORef
import Data.List (sort)
import qualified Data.Map.Strict as M
import Data.Maybe (fromMaybe)
import qualified Data.Set as S
import Data.Text (Text)
import qualified Data.Text as T
import Data.Time.Clock (getCurrentTime)
import Data.Word (Word8)
import Handlers.Transaction (postTransactionListWith, postTransactionWith)
import Prometheus (MonadMonitor (..))
import SQLM (ApiError (..), apiErrorToServantErr)
import Servant (errHTTPCode)
import System.Directory (listDirectory)
import System.Environment (lookupEnv)
import System.FilePath ((</>))
import Test.Hspec

-- | Upquark mainnet, where every fixture was recorded.
rules :: IntakeRules
rules = IntakeRules upquark

------------------------------------------------------------------------------
-- Fixtures

load :: FromJSON a => FilePath -> IO a
load path = eitherDecodeFileStrict' path >>= either (\e -> fail (path ++ ": " ++ e)) pure

transactionOf :: RawTransaction' -> Transaction
transactionOf (RawTransaction' raw) = rawTX2TX raw

recordedHash :: RawTransaction' -> Keccak256
recordedHash (RawTransaction' raw) = rawTransactionTxHash raw

-- | A mined transaction the replay is expected to refuse, and why that is right.
data KnownRefusal = KnownRefusal {knownHash :: Keccak256, knownReason :: Text}

instance FromJSON KnownRefusal where
  parseJSON = withObject "known refusal" $ \o -> KnownRefusal <$> o .: "hash" <*> o .: "reason"

-- | A call that is well formed in every respect; each malformed case below
-- changes one thing about it.
wellFormed :: Text -> [Text] -> Text -> Maybe Integer -> Word8 -> Transaction
wellFormed name texts label cid ver =
  signed $ MessageTX 0 1000000 (Address 0x93fb7295) name texts label cid 0 0 0 ver B.empty

-- | Signs with a fixed test key, the way a server (version 0) or a wallet
-- (version 1) would, so nothing but the envelope separates these from the
-- transactions a node accepts.
signed :: Transaction -> Transaction
signed tx = tx {r = toInteger sr, s = toInteger ss, v = sv}
  where
    key = fromMaybe (error "invalid test private key") $ importPrivateKey (B.replicate 31 0 <> B.singleton 1)
    digest = case tx of
      MessageTX {txVersion = ver} | ver > 0 -> eip712SignHash tx
      _ -> keccak256ToByteString (partialTransactionHash tx)
    (sr, ss, sv) = getSigVals (signMsg key digest)

-- | The address of the test key, as the node recovers it.
testSigner :: Maybe Address
testSigner = whoSignedThisTransaction (wellFormed "transfer" ["1"] "STRATO" Nothing 1)

upquark :: Integer
upquark = 123354377739506

-- | Malformed envelopes, each with the reason intake gives for refusing it.
malformed :: [(Text, Transaction)]
malformed =
  [ ("function_name", call "transfer " ["1"]),
    ("function_name", call " transfer" ["1"]),
    ("function_name", call "" []),
    ("function_name", call "transfer amount" ["1"]),
    ("function_name", call "transfer(address)extra" ["1"]),
    ("constructor_call", call "<constructor>" []),
    ("constructor_call", call " <constructor> (address)" []),
    ("nested_constructor_call", call "callContract" ["\"93fb7295\"", "\"<constructor>\""]),
    ("argument", call "transfer" ["not a literal"]),
    ("argument", call "transfer" ["1", "\"unterminated"]),
    ("network", wellFormed "transfer" ["1"] "bad label" (Just upquark) 1),
    ("chain_id", wellFormed "transfer" ["1"] "STRATO" (Just 195049586845898) 1),
    ("version", wellFormed "transfer" ["1"] "STRATO" (Just upquark) 2)
  ]
  where
    call name texts = wellFormed name texts "STRATO" (Just upquark) 1

-- | Well-formed calls built the same way, as a control for the list above.
controls :: [Transaction]
controls =
  [ wellFormed "transfer" ["\"5b8f21b53d3a5ea7dd66710ff18d161bb62e9a71\"", "100"] "STRATO" (Just upquark) 1,
    wellFormed "transfer" ["\"any text: <b>bold</b>, it's fine\""] "mercata" Nothing 0,
    wellFormed "transfer(address,uint256)" ["\"5b8f21b53d3a5ea7dd66710ff18d161bb62e9a71\"", "100"] "STRATO" Nothing 1
  ]

-- | The request body a client would post for a transaction.
bodyOf :: Transaction -> IO RawTransaction'
bodyOf tx = RawTransaction' . txAndTime2RawTX Origin.API tx (-1) <$> getCurrentTime

------------------------------------------------------------------------------
-- HTTP submission: a handler monad that records what would be published.

newtype Api a = Api (ReaderT (IORef [[IngestEvent]]) IO a)
  deriving (Functor, Applicative, Monad, MonadIO)

instance MonadLogger Api where
  monadLoggerLog _ _ _ _ = pure ()

instance Mod.Outputs Api [IngestEvent] where
  output batch = Api $ ask >>= \published -> liftIO (modifyIORef' published (++ [batch]))

-- | Runs a handler and returns its result, or the API error it answered with,
-- alongside every batch it published.
runApi :: Api a -> IO (Either ApiError a, [[IngestEvent]])
runApi (Api handler) = do
  published <- newIORef []
  outcome <- try (runReaderT handler published)
  (,) outcome <$> readIORef published

------------------------------------------------------------------------------
-- Peer gossip: just the state the handler reads, a node level with the tip.

data GossipState = GossipState
  { gossipStamp :: IORef ActionTimestamp,
    gossipMine :: IORef BestSequencedBlock
  }

tipNumber :: Integer
tipNumber = 993000

newtype Gossip a = Gossip (ReaderT GossipState IO a)
  deriving (Functor, Applicative, Monad, MonadIO)

instance MonadLogger Gossip where
  monadLoggerLog _ _ _ _ = pure ()

instance Mod.Modifiable ActionTimestamp Gossip where
  get _ = Gossip $ asks gossipStamp >>= liftIO . readIORef
  put _ a = Gossip $ asks gossipStamp >>= liftIO . flip writeIORef a

instance HasPeerClaims Gossip where
  claimPeerBest _ _ = pure ()
  withdrawPeerClaim = pure ()
  peerBestNumber = pure tipNumber
  worldBestNumber = pure tipNumber

instance Mod.Modifiable BestSequencedBlock Gossip where
  get _ = Gossip $ asks gossipMine >>= liftIO . readIORef
  put _ a = Gossip $ asks gossipMine >>= liftIO . flip writeIORef a

-- | What the peer handler publishes to this node's stream for one inbound
-- @Transactions@ message.
gossip :: [Transaction] -> IO [[IngestEvent]]
gossip txs = do
  let tip = unsafeCreateKeccak256FromWord256 0
  state <-
    GossipState
      <$> newIORef emptyActionTimestamp
      <*> newIORef (BestSequencedBlock tip tipNumber [] [] 0)
  let Gossip handler = runConduit (handleGossipedTransactions rules (def :: PPeer) txs .| sinkList)
  outputs :: [Either P2PCNC Message] <- runReaderT handler state
  forM outputs $ \case
    Left (ToUnseq events) -> pure events
    _ -> fail "the gossip handler emitted something other than a stream write"

------------------------------------------------------------------------------
-- Sequencer: the witness set it dedups against, and nothing else.

newtype Sequencer a = Sequencer (ReaderT (IORef (S.Set Keccak256)) IO a)
  deriving (Functor, Applicative, Monad, MonadIO)

instance MonadLogger Sequencer where
  monadLoggerLog _ _ _ _ = pure ()

instance MonadMonitor Sequencer where
  doIO = liftIO

instance A.Alters Keccak256 () Sequencer where
  lookup _ k = Sequencer $ ask >>= \seen -> liftIO $ (\known -> if S.member k known then Just () else Nothing) <$> readIORef seen
  insert _ k _ = Sequencer $ ask >>= \seen -> liftIO $ modifyIORef' seen (S.insert k)
  delete _ k = Sequencer $ ask >>= \seen -> liftIO $ modifyIORef' seen (S.delete k)

data Sequenced = Sequenced
  { sequencedCount :: Int,
    toPeers :: [Transaction],
    toVm :: [Transaction],
    witnessed :: S.Set Keccak256
  }

-- | Runs loose transactions through the sequencer's intake under one origin.
sequence' :: Origin.TXOrigin -> [Transaction] -> IO Sequenced
sequence' origin txs = do
  seen <- newIORef S.empty
  now <- getCurrentMicrotime
  let Sequencer run = runConduit (transformFullTransactionsWith rules [(now, IngestTx origin tx) | tx <- txs] `fuseBoth` sinkList)
  (count, events) <- runReaderT run seen
  Sequenced count
    [otBaseTx o | SeqOutEvent peerEvents _ <- events, P2pTx o <- peerEvents]
    [otBaseTx o | SeqOutEvent _ vmTasks <- events, VmTx _ o <- vmTasks]
    <$> readIORef seen

origins :: [(String, Origin.TXOrigin)]
origins = [("the HTTP API", Origin.API), ("a peer", Origin.PeerString "08c9835a@203.0.113.7:30303")]

------------------------------------------------------------------------------

main :: IO ()
main = do
  legitimate :: [RawTransaction'] <- load "test-intake/fixtures/legitimate.json"
  knownRefusals :: [KnownRefusal] <- load "test-intake/fixtures/replay-known-refusals.json"
  replay <- lookupEnv "INTAKE_REPLAY_CORPUS"
  let bad = map snd malformed
  badBodies <- mapM bodyOf bad
  controlBodies <- mapM bodyOf controls
  hspec $ do
    describe "fixtures" $ do
      it "decode to the exact signed transactions the chain recorded" $ do
        forM_ legitimate $ \body -> transactionHash (transactionOf body) `shouldBe` recordedHash body
        length legitimate `shouldSatisfy` (> 100)

      it "the malformed and control transactions are validly signed and survive the request body" $ do
        forM_ (bad ++ controls) $ \tx -> whoSignedThisTransaction tx `shouldBe` testSigner
        map transactionOf (badBodies ++ controlBodies) `shouldBe` bad ++ controls

    describe "HTTP submission" $ do
      it "publishes every legitimate transaction, unchanged, and answers with its hash" $
        forM_ (legitimate ++ controlBodies) $ \body -> do
          (outcome, published) <- runApi (postTransactionWith rules Nothing body)
          case outcome of
            Right h -> h `shouldBe` transactionHash (transactionOf body)
            Left e -> expectationFailure ("refused a legitimate transaction: " ++ show e)
          [[tx | IETx _ (IngestTx Origin.API tx) <- batch] | batch <- published] `shouldBe` [[transactionOf body]]

      it "answers 400 to a malformed transaction and publishes nothing" $
        forM_ badBodies $ \body -> do
          (outcome, published) <- runApi (postTransactionWith rules Nothing body)
          published `shouldSatisfy` null
          case outcome of
            Left failure@(UserError message) -> do
              errHTTPCode (apiErrorToServantErr failure) `shouldBe` 400
              message `shouldSatisfy` T.isPrefixOf "Transaction rejected: "
              -- The answer is fixed text; it does not repeat the transaction's fields.
              message `shouldSatisfy` (not . T.any (`elem` ("<>'=" :: String)))
            Left other -> expectationFailure ("expected a user error, got " ++ show other)
            Right _ -> expectationFailure "a malformed transaction was accepted"

      it "publishes a legitimate batch whole and in order" $ do
        (outcome, published) <- runApi (postTransactionListWith rules Nothing legitimate)
        either (expectationFailure . show) (`shouldBe` map recordedHash legitimate) outcome
        [tx | IETx _ (IngestTx Origin.API tx) <- concat published] `shouldBe` map transactionOf legitimate

      it "refuses a batch containing one malformed transaction, publishing none of it" $
        forM_ badBodies $ \body -> do
          let batch = take 3 legitimate ++ [body] ++ take 3 (drop 3 legitimate)
          (outcome, published) <- runApi (postTransactionListWith rules Nothing batch)
          published `shouldSatisfy` null
          case outcome of
            Left (UserError _) -> pure ()
            _ -> expectationFailure "expected the batch to be refused"

    describe "peer gossip" $ do
      it "publishes legitimate gossip to the node's stream, unchanged and in order" $ do
        let txs = map transactionOf legitimate ++ controls
        published <- gossip txs
        [[tx | IETx _ (IngestTx (Origin.PeerString _) tx) <- batch] | batch <- published] `shouldBe` [txs]

      it "publishes nothing for a message of malformed transactions" $
        gossip bad `shouldReturn` []

      it "drops only the malformed transactions from a mixed message" $ do
        let good = map transactionOf (take (length bad) legitimate)
        published <- gossip (concat (zipWith (\g b -> [g, b]) good bad) ++ controls)
        [tx | IETx _ (IngestTx _ tx) <- concat published] `shouldBe` good ++ controls

    describe "sequencer" $
      forM_ origins $ \(name, origin) -> describe ("transactions from " ++ name) $ do
        it "sends every legitimate transaction to the VM and to peers once, unchanged" $ do
          let txs = map transactionOf legitimate ++ controls
          result <- sequence' origin txs
          sequencedCount result `shouldBe` length txs
          toVm result `shouldBe` txs
          toPeers result `shouldBe` txs
          witnessed result `shouldBe` S.fromList (map transactionHash txs)

        it "refuses a malformed transaction before witnessing, gossip or the VM" $
          forM_ bad $ \tx -> do
            result <- sequence' origin [tx]
            sequencedCount result `shouldBe` 0
            toVm result `shouldBe` []
            toPeers result `shouldBe` []
            witnessed result `shouldBe` S.empty

        it "refuses each for the reason its envelope is malformed" $
          forM_ malformed $ \(reason, tx) -> do
            verdict <- checkIntake rules tx
            either (Just . intakeRejectionLabel) (const Nothing) verdict `shouldBe` Just reason

        it "keeps the order of what it admits from a mixed batch" $ do
          let good = map transactionOf (take (length bad) legitimate)
          result <- sequence' origin (concat (zipWith (\g b -> [b, g]) good bad))
          toVm result `shouldBe` good
          toPeers result `shouldBe` good

    -- The VM reports work for the block it would build next; a view's sequence
    -- is the block committed last.
    describe "pool work" $
      it "counts for the view when it is for the block after the committed one" $
        map (poolWorkIsForView (View 3 7)) [7, 8, 9] `shouldBe` [False, True, False]

    describe "replay" $
      case replay of
        Nothing -> it "replays INTAKE_REPLAY_CORPUS when it is set" $ pendingWith "INTAKE_REPLAY_CORPUS is not set"
        Just directory -> it ("admits every mined transaction under " ++ directory ++ ", bar the documented failed ones") $ do
          files <- sort . filter ((== "nosj.") . take 5 . reverse) <$> listDirectory directory
          tallies <- forM files $ \file -> do
            bodies :: [RawTransaction'] <- load (directory </> file)
            let mined = [body | body@(RawTransaction' raw) <- bodies, rawTransactionBlockNumber raw >= 0]
                txs = map transactionOf mined
            forM_ mined $ \body -> transactionHash (transactionOf body) `shouldBe` recordedHash body
            verdicts <- mapM (checkIntake rules) txs
            let reasons = [(recordedHash body, intakeRejectionLabel reason) | (body, Left reason) <- zip mined verdicts]
            result <- sequence' Origin.API txs
            pure (length mined, reasons, sequencedCount result)
          let total = sum [n | (n, _, _) <- tallies]
              reasons = concat [refusals | (_, refusals, _) <- tallies]
              sequenced = sum [n | (_, _, n) <- tallies]
              byReason = M.toList (M.fromListWith (+) [(label, 1 :: Int) | (_, label) <- reasons])
          putStrLn $ "replayed " ++ show total ++ " mined transactions from " ++ show (length files) ++ " files; refused " ++ show (length reasons) ++ " " ++ show byReason ++ "; sequenced " ++ show sequenced
          unless (null reasons) $ putStrLn $ unlines ["  " ++ show h ++ " " ++ T.unpack label | (h, label) <- take 40 reasons]
          when (total == 0) $ expectationFailure "the corpus is empty"
          let expected = [(knownHash k, knownReason k) | k <- knownRefusals]
          [refusal | refusal <- reasons, refusal `notElem` expected] `shouldBe` []
          sequenced `shouldBe` total - length reasons
