{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE DeriveGeneric         #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TypeOperators         #-}

module BlockApps.Bloc22.API.Search where

import           Control.Applicative              (liftA2)
import           Control.Lens                     ((&), (?~), (.~))
import           Data.Aeson
import           Data.Monoid                      ((<>))
import           Data.Swagger
import qualified Data.Text                        as Text
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck
import           Test.QuickCheck.Instances        ()

import           BlockApps.Bloc22.API.Utils
import           BlockApps.Ethereum
import           BlockApps.Solidity.Xabi

--------------------------------------------------------------------------------
-- | Routes and Types
--------------------------------------------------------------------------------

data Greedy a b = One a | Both a b deriving (Eq, Show)

instance ToJSON (Greedy (MaybeNamed Address) ChainId) where
  toJSON (One addr) = toJSON addr
  toJSON (Both addr cid) = object ["address" .= addr, "chainId" .= cid]

instance FromJSON (Greedy (MaybeNamed Address) ChainId) where
  parseJSON (Object o) = liftA2 Both (o .: "address") (o .: "chainId")
  parseJSON a = One <$> parseJSON a

instance (Arbitrary a, Arbitrary b) => Arbitrary (Greedy a b) where
  arbitrary = oneof
    [ One <$> arbitrary
    , liftA2 Both arbitrary arbitrary
    ]

instance ToHttpApiData (Greedy (MaybeNamed Address) ChainId) where
  toUrlPiece (One addr)  = toUrlPiece addr
  toUrlPiece (Both addr cid) = toUrlPiece addr <> "," <> toUrlPiece cid

instance FromHttpApiData (Greedy (MaybeNamed Address) ChainId) where
  parseUrlPiece txt = case Text.split (==',') txt of
    [addr] -> One <$> parseUrlPiece addr
    [addr,cid] -> liftA2 Both (parseUrlPiece addr) (parseUrlPiece cid)
    xs -> error $ "Expected one or two elements, got " ++ (show $ length xs) ++ " elements"

instance ToSample (Greedy (MaybeNamed Address) ChainId) where
  toSamples _ = [("Public", One (Unnamed (Address 0xdeadbeef)))
                ,("Private", Both (Unnamed (Address 0xdeadbeef))
                                  (ChainId 0x123456879abcdef0123456879abcdef0123456879abcdef0123456879abcdef0))
                ]

instance ToSchema (Greedy (MaybeNamed Address) ChainId) where
  declareNamedSchema _ = return $ NamedSchema (Just "Contract Name, \"Latest\", Or Address, along with ChainId")
      ( mempty
        & type_ .~ SwaggerString
        & example ?~ toJSON (Both (Unnamed (Address 0xdeadbeef))
                                  (ChainId 0x123456879abcdef0123456879abcdef0123456879abcdef0123456879abcdef0))
        & description ?~ "Contract Name, \"Latest\", Or Address, along with ChainId" )

-- GET /search/:contractName
type GetSearchContract = "search"
  :> Capture "contractName" ContractName
  :> Get '[JSON] [Greedy (MaybeNamed Address) ChainId]
