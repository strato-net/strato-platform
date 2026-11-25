{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}

-- | The view timer: the dead-proposer detector that has a validator vote to
-- change round when work is waiting and no proposal arrives for it.
module Main (main) where

import Blockchain.Blockstanbul
import Blockchain.Blockstanbul.StateMachine
import Blockchain.Data.Block (Block)
import Blockchain.Model.SyncState (BestSequencedBlock)
import Blockchain.Sequencer.Monad
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Validator
import Control.Concurrent.AlarmClock (AlarmClock)
import Control.Concurrent.STM (atomically)
import Control.Concurrent.STM.TMChan
import Control.Lens hiding (view)
import Control.Monad (join)
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Vault
import Control.Monad.Reader
import Data.IORef
import Data.Time.Clock (UTCTime)
import System.Timeout (timeout)
import Test.Hspec

me, other :: Address
me = 0x1111111111111111111111111111111111111111
other = 0x2222222222222222222222222222222222222222

data Env = Env
  { envContext :: IORef BlockstanbulContext,
    envViewAndProposal :: IORef (View, Maybe Block),
    envViewTimer :: IORef (Maybe ViewTimer),
    envWorkPending :: WorkPending,
    envRoundClock :: IORef (Maybe (AlarmClock UTCTime)),
    envRoundTimer :: IORef (Maybe (View, UTCTime)),
    envTimeouts :: TMChan View
  }

newtype TestM a = TestM {unTestM :: ReaderT Env IO a}
  deriving (Functor, Applicative, Monad, MonadIO, MonadReader Env)

instance HasBlockstanbulContext TestM where
  getBlockstanbulContext = asks envContext >>= liftIO . readIORef
  putBlockstanbulContext ctx = asks envContext >>= liftIO . flip writeIORef ctx

instance Mod.Accessible (IORef (View, Maybe Block)) TestM where
  access _ = asks envViewAndProposal

instance Mod.Accessible (IORef (Maybe ViewTimer)) TestM where
  access _ = asks envViewTimer

instance Mod.Accessible WorkPending TestM where
  access _ = asks envWorkPending

instance Mod.Accessible (IORef (Maybe (AlarmClock UTCTime))) TestM where
  access _ = asks envRoundClock

instance Mod.Accessible (IORef (Maybe (View, UTCTime))) TestM where
  access _ = asks envRoundTimer

instance Mod.Accessible (TMChan View) TestM where
  access _ = asks envTimeouts

instance Mod.Accessible BlockPeriod TestM where
  access _ = pure $ BlockPeriod 0

instance Mod.Accessible RoundPeriod TestM where
  access _ = pure $ RoundPeriod 3600

instance Mod.Accessible ProposalTimeout TestM where
  access _ = pure $ ProposalTimeout 0.05

instance Mod.Modifiable BestSequencedBlock TestM where
  get _ = error "the view timer does not read the best sequenced block"
  put _ _ = pure ()

instance HasVault TestM where
  sign _ = error "the view timer does not sign"
  getPub = error "the view timer does not sign"
  postKey = error "the view timer does not sign"
  getShared _ = error "the view timer does not sign"

-- | Two validators at height 5, round 0, with this node proposing.
setup :: IO Env
setup = do
  let ckpt = Checkpoint (View 0 5) [Validator me, Validator other] Nothing [] 0
      ctx = newContext "" 1 ckpt (Just me) True Nothing 15 & proposer .~ Validator me
  Env
    <$> newIORef ctx
    <*> newIORef (View 0 5, Nothing)
    <*> newIORef Nothing
    <*> (WorkPending <$> newIORef Nothing)
    <*> newIORef Nothing
    <*> newIORef Nothing
    <*> newTMChanIO

run :: Env -> TestM a -> IO a
run env = flip runReaderT env . unTestM

-- | The view the next timeout is for, if one fires within a second.
nextTimeout :: Env -> IO (Maybe View)
nextTimeout env = fmap join . timeout 1000000 . atomically . readTMChan $ envTimeouts env

main :: IO ()
main = hspec . describe "The view timer" $ do
  it "times out a later round of a height whose work arrived while this node proposed" $ do
    env <- setup
    run env $ do
      -- Work arrives while this node proposes: it arms no timer for itself.
      createNewViewTimer
      -- Its proposal never comes, the others time it out, and round 1 has
      -- another proposer, so the work still waits.
      ctx <- getBlockstanbulContext
      putBlockstanbulContext $ ctx & view .~ View 1 5 & proposer .~ Validator other
      carryViewTimer (View 1 5)
    nextTimeout env `shouldReturn` Just (View 1 5)

  it "carries nothing to the next height" $ do
    env <- setup
    run env $ do
      createNewViewTimer
      -- The block committed, and the work with it.
      ctx <- getBlockstanbulContext
      putBlockstanbulContext $ ctx & view .~ View 0 6 & proposer .~ Validator other
      carryViewTimer (View 0 6)
    nextTimeout env `shouldReturn` Nothing
