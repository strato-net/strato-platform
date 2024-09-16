{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS -fno-warn-orphans      #-}

module Blockchain.Strato.Model.Delta
  ( Delta (..),
    toDelta,
    fromDelta,
    eqDelta,
    ValidatorDelta,
    CertDelta,
    getDeltasFromEvents
  )
where

import BlockApps.X509.Certificate
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class (DummyCertRevocation (..))
import Blockchain.Strato.Model.CodePtr ()
import Blockchain.Strato.Model.Event
import Blockchain.Strato.Model.Validator
import Control.DeepSeq
import Control.Lens hiding (Context (..))
import Control.Monad ((<=<))
import Data.Function (on)
import Data.List (find)
import qualified Data.Text as T
import Data.Text.Encoding (encodeUtf8)
import GHC.Generics

data Delta a b = Delta 
  { _added   :: [a] -> [a]
  , _removed :: [b] -> [b]
  }
  deriving (Generic)

instance NFData (Delta a b) where
  rnf (Delta _ _) = ()

instance Semigroup (Delta a b) where
  (Delta a1 r1) <> (Delta a2 r2) = Delta (a1 . a2) (r1 . r2)

instance Monoid (Delta a b) where
  mempty = Delta id id
  mappend = (<>)

toDelta :: [a] -> [b] -> Delta a b
toDelta as bs = Delta (as++) (bs++)

fromDelta :: Delta a b -> ([a], [b])
fromDelta (Delta a b) = (a [], b [])

eqDelta :: (Eq a, Eq b) => Delta a b -> Delta a b -> Bool
eqDelta = (==) `on` fromDelta

type ValidatorDelta = Delta Validator Validator
type CertDelta = Delta X509Certificate DummyCertRevocation

getDeltasFromEvents :: [Event] -> (ValidatorDelta, CertDelta)
getDeltasFromEvents = foldr go (mempty, mempty)
  where go e ds@(vd@(Delta va vr), cd@(Delta ca cr)) = case evContractAccount e of
          Account 0x100 Nothing -> case evName e of -- MercataGovernance
            "ValidatorAdded" -> maybe ds (\v -> (Delta ((v:) . va) vr, cd)) $ extractCommonName e
            "ValidatorRemoved" -> maybe ds (\v -> (Delta va ((v:) . vr), cd)) $ extractCommonName e
            _ -> ds
          Account 0x509 Nothing -> case evName e of -- CertificateRegistry
            "CertificateRegistered" -> maybe ds (\c -> (vd, Delta ((c:) . ca) cr)) $ registration e
            "CertificateRevoked" -> maybe ds (\c -> (vd, Delta ca ((c:) . cr))) $ revocation e
            _ -> ds
          _ -> ds
        extractCommonName = fmap (Validator . T.pack . second) . find (\(x, _, _) -> x == "commonName") . evArgs
        registration      = either (const Nothing) Just . bsToCert . encodeUtf8 . T.pack <=< getFirstArg
        revocation        = pure . DummyCertRevocation <=< stringAddress <=< getFirstArg
        getFirstArg       = pure . second . fst <=< uncons . evArgs
        second (_, y, _)  = y