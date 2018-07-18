{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds                  #-}
{-# LANGUAGE DeriveGeneric              #-}
{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedLists            #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE ScopedTypeVariables        #-}
{-# LANGUAGE TypeOperators              #-}

module BlockApps.Bloc22.API.Chain where

import           Control.Lens                       (mapped)
import           Control.Lens.Operators             hiding ((.=))
import           Data.Aeson                         hiding (Success)
import           Data.Aeson.Casing
import qualified Data.ByteString.Lazy               as ByteString.Lazy
import           Data.Map                           (Map)
import qualified Data.Map                           as Map
import           Data.Proxy
import           Data.Text                          (Text)
import qualified Data.Text.Encoding                 as Text
import           Generic.Random.Generic
import           GHC.Generics
import           Numeric.Natural
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck                    hiding (Success,Failure)

import           BlockApps.Bloc22.API.SwaggerSchema
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Crypto
import           BlockApps.Ethereum
import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Types

--------------------------------------------------------------------------------
-- | Routes and types
--------------------------------------------------------------------------------

data ChainInfo = ChainInfo
  { chainInfoSrc            :: Text
  , chainInfoLabel          :: Text
  , chainInfoAccountInfo    :: [(Address, Integer)]
  , chainInfoVariableValues :: [(Text, Text)]
  } deriving (Eq, Show, Generic)

instance Arbitrary ChainInfo where
  arbitrary = genericArbitrary uniform

instance FromJSON ChainInfo where
  genericParseJSON (aesonPrefix camelCase)

instance ToJSON ChainInfo where
  genericToJSON (aesonPrefix camelCase)

instance ToSample ChainInfo where
  toSamples _ = singleSample ChainInfo
    { chainInfoSrc = "contract Governance { enum AddRule = AUTO_APPROVE, TWO_VOTES_IN, MAJORITY_RULES; enum RemoveRule = AUTO_APPROVE, TWO_VOTES_IN, MAJORITY_RULES; AddRule addRule; RemoveRule removeRule; event MemberAdded (address member); event MemberRemoved (address member); struct MemberVotes { address member; uint votes; } MemberVotes[] addVotes; MemberVotes[] removeVotes; function voteToAdd(address m) { for (uint i = 0; i < addVotes.length; i++) { if (addVotes[i].member == m) { addVotes[i].votes++; } } } function voteToRemove(address m) { for (uint i = 0; i < removeVotes.length; i++) { if (removeVotes[i].member == m) { removeVotes[i].votes++; } } } }" 
    , chainInfoLabel = "my chain"
    , chainInfoAccountInfo = [
         ("5815b9975001135697b5739956b9a6c87f1c575c", "20000000")
       , ("93fdd1d21502c4f87295771253f5b71d897d911c", "999999")
       ]
    , chainInfoVariableValues = [
         ("addRule", "AUTO_APPROVE")
       , ("removeRule", "AUTO_APPROVE")
       ]
    }

instance ToSchema ChainInfo where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "Send ether from one account to another (value is in Wei)"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: ChainInfo
      ex = ChainInfo
        { chainInfoSrc = "contract Governance { enum AddRule = AUTO_APPROVE, TWO_VOTES_IN, MAJORITY_RULES; enum RemoveRule = AUTO_APPROVE, TWO_VOTES_IN, MAJORITY_RULES; AddRule addRule; RemoveRule removeRule; event MemberAdded (address member); event MemberRemoved (address member); struct MemberVotes { address member; uint votes; } MemberVotes[] addVotes; MemberVotes[] removeVotes; function voteToAdd(address m) { for (uint i = 0; i < addVotes.length; i++) { if (addVotes[i].member == m) { addVotes[i].votes++; } } } function voteToRemove(address m) { for (uint i = 0; i < removeVotes.length; i++) { if (removeVotes[i].member == m) { removeVotes[i].votes++; } } } }" 
        , chainInfoLabel = "my chain"
        , chainInfoAccountInfo = [
            ("5815b9975001135697b5739956b9a6c87f1c575c", "20000000")
          , ("93fdd1d21502c4f87295771253f5b71d897d911c", "999999")
          ]
        , chainInfoVariableValues = [
            ("addRule", "AUTO_APPROVE")
          , ("removeRule", "AUTO_APPROVE")
          ]
        }

--------------------------------------------------------------------------------

-- POST /chain

type PostChain = "chain"
  :> ReqBody '[JSON] ChainInfo 
  :> Post '[JSON] ChainInfo

