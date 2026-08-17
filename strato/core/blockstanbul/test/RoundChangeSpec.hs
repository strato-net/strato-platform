{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module RoundChangeSpec where

import BlockApps.Logging
import Blockchain.Blockstanbul
import Blockchain.Blockstanbul.StateMachine
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Control.Lens hiding (view)
import Control.Monad.Composable.Vault
import Control.Monad.State.Strict
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as C8
import Data.Maybe
import qualified Data.Set as S
import qualified LabeledError
import Test.Hspec
import Prelude hiding (round)

myPriv :: PrivateKey
myPriv =
  fromMaybe (error "could not import private key")
    . importPrivateKey
    . LabeledError.b16Decode "myPriv"
    $ C8.pack "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"

me :: Address
me = fromPrivateKey myPriv

other :: Address
other = 0x1111111111111111111111111111111111111111

third :: Address
third = 0x2222222222222222222222222222222222222222

instance Monad m => HasBlockstanbulContext (StateT BlockstanbulContext m) where
  getBlockstanbulContext = get
  putBlockstanbulContext = put

instance {-# OVERLAPPING #-} Monad m => HasVault (StateT BlockstanbulContext m) where
  sign bs = return $ signMsg myPriv bs
  getPub = error "called getPub in RoundChangeSpec"
  postKey = error "called postKey in RoundChangeSpec"
  getShared _ = error "called getShared in RoundChangeSpec"

runTest :: BlockstanbulContext -> StateT BlockstanbulContext (LoggingT IO) a -> IO a
runTest ctx = runNoLoggingT . flip evalStateT ctx

-- One dummy validator so newContext can pick a proposer; tests overwrite the set.
baseCtx :: Bool -> Maybe Address -> BlockstanbulContext
baseCtx valB self =
  let ctx = newContext "" (Checkpoint (View 20 18) [Validator other]) self valB
   in ctx & productionAuth .~ False

roundChanges :: [OutEvent] -> [TrustedMessage]
roundChanges evs = [m | OMsg _ m@RoundChange {} <- evs]

spec :: Spec
spec = describe "ROUNDCHANGE emission" $ do
  it "does not originate a ROUNDCHANGE when this node is not in the validator set" $ do
    let ctx =
          baseCtx True (Just me)
            & validators .~ S.fromList [Validator other, Validator third]
    got <- runTest ctx $ sendMessages [Timeout 20]
    roundChanges got `shouldBe` []

  it "does not originate a ROUNDCHANGE when validatorBehavior is off" $ do
    let ctx =
          baseCtx False (Just me)
            & validators .~ S.fromList [Validator me, Validator other]
    got <- runTest ctx $ sendMessages [Timeout 20]
    roundChanges got `shouldBe` []

  it "originates a single ROUNDCHANGE on the first timeout if this node is a validator" $ do
    let ctx =
          baseCtx True (Just me)
            & validators .~ S.fromList [Validator me, Validator other]
    got <- runTest ctx $ sendMessages [Timeout 20]
    map (_round . roundchangeView) (roundChanges got) `shouldBe` [21]

  it "does not emit another ROUNDCHANGE for the same pending round" $ do
    let ctx =
          baseCtx True (Just me)
            & validators .~ S.fromList [Validator me, Validator other]
    got <- runTest ctx $ do
      _ <- sendMessages [Timeout 20]
      sendMessages [Timeout 20]
    roundChanges got `shouldBe` []

  it "rebroadcasts an inbound ROUNDCHANGE with the original nonce" $ do
    let auth = MsgAuth other (signMsg myPriv (B.replicate 32 0))
        inbound = RoundChange (View 21 18) 0xdeadbeef
        ctx =
          baseCtx True (Just me)
            & validators .~ S.fromList [Validator me, Validator other, Validator third]
    got <- runTest ctx $ sendMessages [IMsg auth inbound]
    let gossiped = [n | OMsg a (RoundChange _ n) <- got, sender a == other]
    gossiped `shouldBe` [0xdeadbeef]

  it "binds ROUNDCHANGE signatures to the view, not the nonce" $ do
    let a = RoundChange (View 21 18) 1
        b = RoundChange (View 21 18) 2
        c = RoundChange (View 22 18) 1
    getHash a `shouldBe` getHash b
    getHash a `shouldNotBe` getHash c

  it "counts one vote when a validator sends two nonces for the same next round" $ do
    let vw = View 21 18
        auth = MsgAuth other (signMsg myPriv (B.replicate 32 0))
        ctx =
          baseCtx True (Just me)
            & validators .~ S.fromList [Validator me, Validator other, Validator third]
    (got, nVotes) <- runTest ctx $ do
      evs <- sendMessages
        [ IMsg auth (RoundChange vw 1),
          IMsg auth (RoundChange vw 2)
        ]
      votes <- use $ roundChanged . at 21
      pure (evs, maybe 0 S.size votes)
    let gossiped = [n | OMsg a (RoundChange _ n) <- got, sender a == other]
    gossiped `shouldBe` [1]
    nVotes `shouldBe` 1

  it "drops a ROUNDCHANGE that is not exactly current+1" $ do
    let auth = MsgAuth other (signMsg myPriv (B.replicate 32 0))
        ctx =
          baseCtx True (Just me)
            & validators .~ S.fromList [Validator me, Validator other, Validator third]
    (got, rcMap) <- runTest ctx $ do
      evs <- sendMessages
        [ IMsg auth (RoundChange (View 22 18) 1),
          IMsg auth (RoundChange (View 20 18) 1),
          IMsg auth (RoundChange (View 1000000 18) 1)
        ]
      m <- use roundChanged
      pure (evs, m)
    roundChanges got `shouldBe` []
    rcMap `shouldBe` mempty

  it "counts two different validators for the same next round" $ do
    let vw = View 21 18
        authA = MsgAuth other (signMsg myPriv (B.replicate 32 0))
        authB = MsgAuth third (signMsg myPriv (B.replicate 32 0))
        ctx =
          baseCtx True (Just me)
            & validators .~ S.fromList [Validator me, Validator other, Validator third]
    nVotes <- runTest ctx $ do
      _ <- sendMessages
        [ IMsg authA (RoundChange vw 1),
          IMsg authB (RoundChange vw 2)
        ]
      votes <- use $ roundChanged . at 21
      pure $ maybe 0 S.size votes
    nVotes `shouldBe` 2

  it "rejects a ROUNDCHANGE whose signature does not bind the view when auth is on" $ do
    let inbound = RoundChange (View 21 18) 0x11
        auth = MsgAuth me (signMsg myPriv (B.replicate 32 0))
        ctx =
          baseCtx True (Just other)
            & validators .~ S.fromList [Validator me, Validator other]
            & productionAuth .~ True
    got <- runTest ctx $ sendMessages [IMsg auth inbound]
    let gossiped = [n | OMsg a (RoundChange _ n) <- got, sender a == me]
    gossiped `shouldBe` []

  it "accepts a ROUNDCHANGE whose signature binds the view when auth is on" $ do
    let inbound = RoundChange (View 21 18) 0x11
        auth = MsgAuth me (signMsg myPriv (getHash inbound))
        ctx =
          baseCtx True (Just other)
            & validators .~ S.fromList [Validator me, Validator other]
            & productionAuth .~ True
    got <- runTest ctx $ sendMessages [IMsg auth inbound]
    let gossiped = [n | OMsg a (RoundChange _ n) <- got, sender a == me]
    gossiped `shouldBe` [0x11]
