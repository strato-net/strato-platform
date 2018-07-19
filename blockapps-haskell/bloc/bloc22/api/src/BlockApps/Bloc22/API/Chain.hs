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
import           Data.Text                          (Text)
import           Generic.Random.Generic
import           GHC.Generics
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck                    hiding (Success,Failure)

import           BlockApps.Bloc22.API.SwaggerSchema
import           BlockApps.Ethereum

--------------------------------------------------------------------------------
-- | Routes and types
--------------------------------------------------------------------------------
data ChainInput  = ChainInput
  { chainInputSrc            :: Text
  , chainInputLabel          :: Text
  , chainInputAccountInfo    :: [(Address, Integer)]
  , chainInputVariableValues :: [(Text, Text)]
  , chainInputMembers        :: [(Address, Text)]
  } deriving (Eq, Show, Generic)

instance Arbitrary ChainInput where
  arbitrary = genericArbitrary uniform

instance FromJSON ChainInput where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToJSON ChainInput where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance ToSample ChainInput where
  toSamples _ = singleSample ChainInput
    { chainInputSrc = "contract Governance { enum AddRule = AUTO_APPROVE, TWO_VOTES_IN, MAJORITY_RULES; enum RemoveRule = AUTO_APPROVE, TWO_VOTES_IN, MAJORITY_RULES; AddRule addRule; RemoveRule removeRule; event MemberAdded (address member); event MemberRemoved (address member); struct MemberVotes { address member; uint votes; } MemberVotes[] addVotes; MemberVotes[] removeVotes; function voteToAdd(address m) { for (uint i = 0; i < addVotes.length; i++) { if (addVotes[i].member == m) { addVotes[i].votes++; } } } function voteToRemove(address m) { for (uint i = 0; i < removeVotes.length; i++) { if (removeVotes[i].member == m) { removeVotes[i].votes++; } } } }" 
    , chainInputLabel = "my chain"
    , chainInputAccountInfo = [
         (Address 0x5815b9975001135697b5739956b9a6c87f1c575c, (20000000 :: Integer))
       , (Address 0x93fdd1d21502c4f87295771253f5b71d897d911c, (999999 :: Integer))
       ]
    , chainInputVariableValues = [
         ("addRule", "AUTO_APPROVE")
       , ("removeRule", "AUTO_APPROVE")
       ]
    , chainInputMembers = [(Address 0x5815b9975001135697b5739956b9a6c87f1c575c, "enode://6d8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@171.16.0.4:30303"), (Address 0x93fdd1d21502c4f87295771253f5b71d897d911c, "enode://6f8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@172.16.0.5:30303?discport=30303")] 
    }

instance ToSchema ChainInput where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "Send ether from one account to another (value is in Wei)"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: ChainInput
      ex = ChainInput
        { chainInputSrc = "contract Governance { enum AddRule = AUTO_APPROVE, TWO_VOTES_IN, MAJORITY_RULES; enum RemoveRule = AUTO_APPROVE, TWO_VOTES_IN, MAJORITY_RULES; AddRule addRule; RemoveRule removeRule; event MemberAdded (address member); event MemberRemoved (address member); struct MemberVotes { address member; uint votes; } MemberVotes[] addVotes; MemberVotes[] removeVotes; function voteToAdd(address m) { for (uint i = 0; i < addVotes.length; i++) { if (addVotes[i].member == m) { addVotes[i].votes++; } } } function voteToRemove(address m) { for (uint i = 0; i < removeVotes.length; i++) { if (removeVotes[i].member == m) { removeVotes[i].votes++; } } } }" 
        , chainInputLabel = "my chain"
        , chainInputAccountInfo = [
            (Address 0x5815b9975001135697b5739956b9a6c87f1c575c, (20000000 :: Integer))
          , (Address 0x93fdd1d21502c4f87295771253f5b71d897d911c, (999999 :: Integer))
          ]
        , chainInputVariableValues = [
            ("addRule", "AUTO_APPROVE")
          , ("removeRule", "AUTO_APPROVE")
          ]
        , chainInputMembers = [(Address 0x5815b9975001135697b5739956b9a6c87f1c575c, "enode://6d8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@171.16.0.4:30303"), (Address 0x93fdd1d21502c4f87295771253f5b71d897d911c, "enode://6f8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@172.16.0.5:30303?discport=30303")] 
       }

--------------------------------------------------------------------------------

-- POST /chain

type PostChain = "chain"
  :> ReqBody '[JSON] ChainInput
  :> Post '[JSON] ChainId

