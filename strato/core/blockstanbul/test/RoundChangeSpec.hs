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
-- View 20 18 = round 20, sequence 18; no stakes, so every validator weighs 1.
baseCtx :: Bool -> Maybe Address -> BlockstanbulContext
baseCtx valB self =
  let ckpt = Checkpoint (View 20 18) [Validator other] Nothing [] 0
      ctx = newContext "" 1 ckpt self valB Nothing
   in ctx & productionAuth .~ False

roundChanges :: [OutEvent] -> [TrustedMessage]
roundChanges evs = [m | OMsg _ m@RoundChange {} <- evs]

spec :: Spec
spec = describe "ROUNDCHANGE emission" $ do
  it "does not originate a ROUNDCHANGE when this node is not in the validator set" $ do
    let ctx =
          baseCtx True (Just me)
            & validators .~ S.fromList [Validator other, Validator third]
    got <- runTest ctx $ sendMessages [Timeout (View 20 18)]
    roundChanges got `shouldBe` []

  it "does not originate a ROUNDCHANGE when validatorBehavior is off" $ do
    let ctx =
          baseCtx False (Just me)
            & validators .~ S.fromList [Validator me, Validator other]
    got <- runTest ctx $ sendMessages [Timeout (View 20 18)]
    roundChanges got `shouldBe` []

  it "originates a single ROUNDCHANGE on the first timeout if this node is a validator" $ do
    let ctx =
          baseCtx True (Just me)
            & validators .~ S.fromList [Validator me, Validator other]
    got <- runTest ctx $ sendMessages [Timeout (View 20 18)]
    map (_round . roundchangeView) (roundChanges got) `shouldBe` [21]

  it "does not emit another ROUNDCHANGE for the same pending round" $ do
    let ctx =
          baseCtx True (Just me)
            & validators .~ S.fromList [Validator me, Validator other]
    got <- runTest ctx $ do
      _ <- sendMessages [Timeout (View 20 18)]
      sendMessages [Timeout (View 20 18)]
    roundChanges got `shouldBe` []

  it "rebroadcasts an inbound ROUNDCHANGE with the original nonce" $ do
    let auth = MsgAuth other (signMsg myPriv (B.replicate 32 0))
        inbound = RoundChange (View 24 18) 0xdeadbeef
        ctx =
          baseCtx True (Just me)
            & validators .~ S.fromList [Validator me, Validator other, Validator third]
    got <- runTest ctx $ sendMessages [IMsg auth inbound]
    let gossiped = [n | OMsg a (RoundChange _ n) <- got, sender a == other]
    gossiped `shouldBe` [0xdeadbeef]
