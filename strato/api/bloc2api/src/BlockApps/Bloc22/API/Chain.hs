{-# OPTIONS_GHC -fno-warn-orphans         #-}
{-# OPTIONS_GHC -fno-warn-missing-methods #-}

{-# LANGUAGE DataKinds                    #-}
{-# LANGUAGE DeriveGeneric                #-}
{-# LANGUAGE FlexibleInstances            #-}
{-# LANGUAGE GeneralizedNewtypeDeriving   #-}
{-# LANGUAGE MultiParamTypeClasses        #-}
{-# LANGUAGE OverloadedLists              #-}
{-# LANGUAGE OverloadedStrings            #-}
{-# LANGUAGE ScopedTypeVariables          #-}
{-# LANGUAGE TypeApplications             #-}
{-# LANGUAGE TypeOperators                #-}
{-# LANGUAGE TypeSynonymInstances         #-}

module BlockApps.Bloc22.API.Chain where

import           Control.Lens                       (mapped)
import           Control.Lens.Operators             hiding ((.=))
import           Data.Aeson                         hiding (Success)
import           Data.Aeson.Casing
import           Data.Map.Strict                    (Map)
import qualified Data.Map.Strict                    as Map
import           Data.Maybe
import           Data.Text                          (Text)
import qualified Generic.Random                     as GR
import           GHC.Generics
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck                    hiding (Success,Failure)

import           BlockApps.Bloc22.API.SwaggerSchema
import           BlockApps.Solidity.ArgValue

import           Blockchain.Data.AlternateTransaction ()
import           Blockchain.Data.ArbitraryInstances ()
import           Blockchain.Data.Enode
import           Blockchain.TypeLits
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.ExtendedWord
import           Data.Source.Map

--------------------------------------------------------------------------------
-- | Routes and types
--------------------------------------------------------------------------------
data ChainInput  = ChainInput
  { chaininputSrc      :: SourceMap
  , chaininputCodePtr  :: Maybe CodePtr
  , chaininputContract :: Maybe Text
  , chaininputLabel    :: Text
  , chaininputBalances :: NamedMap "address" "balance" Address Integer
  , chaininputArgs     :: Map Text ArgValue
  , chaininputMembers  :: NamedMap "address" "enode" Address Enode
  , chaininputParentChain :: Maybe Word256
  , chaininputMetadata :: Maybe (Map Text Text)
  , chaininputAsync    :: Maybe Bool
  } deriving (Eq, Show, Generic)

instance ToSchema (NamedTuple "address" "balance" Address Integer) where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "address and balance pair"
    & mapped.schema.example ?~ toJSON (NamedTuple @"address" @"balance" (Address 0x5815b9975001135697b5739956b9a6c87f1c575c, (20000000 :: Integer)))

instance ToSchema (NamedTuple "address" "enode" Address Enode) where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "address and enode pair"
    & mapped.schema.example ?~ toJSON (NamedTuple @"address" @"balance" (Address 0x5815b9975001135697b5739956b9a6c87f1c575c, exampleEnode1))

instance Arbitrary ChainInput where
  arbitrary = GR.genericArbitrary GR.uniform

instance FromJSON ChainInput where
  parseJSON (Object o) =
    ChainInput
      <$> (fromMaybe mempty <$> o .:? "src")
      <*> (o .:? "codePtr")
      <*> (o .:? "contract")
      <*> (o .: "label")
      <*> (o .: "balances")
      <*> (o .: "args")
      <*> (o .: "members")
      <*> (o .:? "parentChain")
      <*> (o .:? "metadata")
      <*> (o .:? "async")
  parseJSON o = fail $ "parseJSON ChainInput: Expected Object, got " ++ show o

instance ToJSON ChainInput where
  toJSON = genericToJSON (aesonPrefix camelCase)

exampleSrc :: Text
exampleSrc = "contract Governance { enum Rule { AUTO_APPROVE, TWO_VOTES_IN, MAJORITY_RULES } Rule addRule; Rule removeRule; Rule terminateRule; event MemberAdded (address member, string enode); event MemberRemoved (address member); event ChainTerminated(); struct MemberVotes { address member; uint votes; } MemberVotes[] addVotes; MemberVotes[] removeVotes; uint terminateVotes; function voteToAdd(address m, string e) { MemberAdded(m,e); } function voteToRemove(address m) { MemberRemoved(m); } function voteToTerminate() { terminateVotes++; if (satisfiesRule(terminateRule, terminateVotes)) { ChainTerminated(); } } function satisfiesRule(Rule rule, uint votes) returns (bool) { if (rule == Rule.AUTO_APPROVE) { return true; } else if (rule == Rule.TWO_VOTES_IN) { return votes >= 2; } else { return true; } } }";

exampleEnode1 :: Enode
exampleEnode1 = Enode (OrgId "6d8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0")
                      (readIP "171.16.0.4")
                      30303
                      Nothing

exampleEnode2 :: Enode
exampleEnode2 = Enode (OrgId "6f8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0")
                      (readIP "172.16.0.5")
                      30303
                      (Just 30303)

exChainInput :: ChainInput
exChainInput = ChainInput
    { chaininputSrc = unnamedSource exampleSrc
    , chaininputCodePtr = Nothing
    , chaininputContract = Just "Governance"
    , chaininputLabel = "my chain"
    , chaininputBalances = map (NamedTuple @"address" @"balance") [
         (Address 0x5815b9975001135697b5739956b9a6c87f1c575c, (20000000 :: Integer))
       , (Address 0x93fdd1d21502c4f87295771253f5b71d897d911c, (999999 :: Integer))
       ]
    , chaininputArgs = Map.fromList [
         ("addRule", ArgString "AUTO_APPROVE")
       , ("removeRule", ArgString "AUTO_APPROVE")
       ]
    , chaininputMembers = map (NamedTuple @"address" @"enode") [
         (Address 0x5815b9975001135697b5739956b9a6c87f1c575c, exampleEnode1)
       , (Address 0x93fdd1d21502c4f87295771253f5b71d897d911c, exampleEnode2)
       ]
    , chaininputParentChain = Nothing
    , chaininputMetadata = Just $ Map.fromList [("history","Governance")]
    , chaininputAsync = Nothing
    }

instance ToSample ChainInput where
  toSamples _ = singleSample exChainInput

instance ToSchema ChainInput where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "Chain Input Info"
    & mapped.schema.example ?~ toJSON exChainInput

instance ToParam (QueryParams "chainid" ChainId) where
  toParam _ = DocQueryParam "chainid" [] "chain ID to be looked up" Normal


data ChainOutput = ChainOutput
  { chainoutputLabel    :: Text
  , chainoutputBalances :: NamedMap "address" "balance" Address Integer
  , chainoutputMembers  :: NamedMap "address" "enode" Address Enode
  } deriving (Eq, Show, Generic)

instance Arbitrary ChainOutput where
  arbitrary = GR.genericArbitrary GR.uniform

instance FromJSON ChainOutput where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToJSON ChainOutput where
  toJSON = genericToJSON (aesonPrefix camelCase)

exChainOutput :: ChainOutput
exChainOutput = ChainOutput
  { chainoutputLabel = "my chain"
  , chainoutputBalances = map (NamedTuple @"address" @"balance") [
      (Address 0x5815b9975001135697b5739956b9a6c87f1c575c, (20000000 :: Integer))
    , (Address 0x93fdd1d21502c4f87295771253f5b71d897d911c, (999999 :: Integer))
    ]
  , chainoutputMembers = map (NamedTuple @"address" @"enode") [
      (Address 0x5815b9975001135697b5739956b9a6c87f1c575c, exampleEnode1)
    , (Address 0x93fdd1d21502c4f87295771253f5b71d897d911c, exampleEnode2)
    ]
  }

instance ToSample ChainOutput where
  toSamples _ = singleSample exChainOutput

instance ToSchema ChainOutput where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "Chain Output Info"
    & mapped.schema.example ?~ toJSON exChainOutput


type ChainIdChainOutput = NamedTuple "id" "info" ChainId ChainOutput

exChainIdChainOutput :: ChainIdChainOutput
exChainIdChainOutput = NamedTuple @"id" @"info"
 ((fromJust $ stringChainId "6c5fdccedeaf8fb957618b0005015c6717c17525835c03d20deccf8ceb0d51a7i"), exChainOutput)

instance ToSample ChainIdChainOutput where
  toSamples _ = singleSample exChainIdChainOutput

instance ToSchema ChainIdChainOutput where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "Chain Output Info"
--    TODO: Figure out why this line crashes the entire Bloc API doc? Works just fine for ChainIdChainInfo in Strato docs
--    & mapped.schema.example ?~ toJSON exChainIdChainOutput

--------------------------------------------------------------------------------

-- POST /chain

type PostChainInfo = "chain"
  :> Servant.API.Header "X-USER-UNIQUE-NAME" Text
  :> ReqBody '[JSON] ChainInput
  :> Post '[JSON] ChainId

-- GET /chain

type GetChainInfo = "chain"
  :> QueryParams "chainid" ChainId
  :> Get '[JSON] [ChainIdChainOutput]

-- POST /chains

type PostChainInfos = "chains"
  :> Servant.API.Header "X-USER-UNIQUE-NAME" Text
  :> ReqBody '[JSON] [ChainInput]
  :> Post '[JSON] [ChainId]
