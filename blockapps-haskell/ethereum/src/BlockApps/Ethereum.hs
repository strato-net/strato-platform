{-# OPTIONS_GHC -fno-warn-orphans  #-}
{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedLists       #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE TypeApplications      #-}

module BlockApps.Ethereum
  ( -- Number type reexports
  word256ToBytes
  , bytesToWord256            -- not used
  , lastWord64
  , Hex (..)
  , unAddress
  , deriveAddress
  , addressString
  , stringAddress
  , newSecKey
  , ChainId (..)
  , chainIdString
  , stringChainId
  , shaToHex
  , keccak256
  , keccak256lazy   -- not used
  , keccak256SHA
  , shaKeccak256
  , keccak256ByteString
  , byteStringKeccak256
  , keccak256String
  , stringKeccak256    -- not used
  , keccak256Address
    -- * Account States
  , AccountState (..)
    -- * Transactions
  , Transaction (..)
  , UnsignedTransaction (..)
  , rlpMsg                     -- not used
  , rlpHash
  , signTransaction
  , verifyTransaction
  , recoverTransaction
  , transactionFrom
  , newAccountAddress           -- not used
    -- * Blocks
  , BlockHeader (..)            -- not used
    -- * Ethereum Types
  , Nonce (..)
  , incrNonce                  -- not used
  , Wei (..)
  -- , eth
  , Gas (..)
  , BloomFilter (..)
  , CodeInfo (..)
  , AccountInfo (..)
  , padZeros                  -- not used
  ) where

import           Control.Lens.Operators
import           Control.DeepSeq (NFData)
import           Crypto.Random.Entropy
import           Crypto.HaskoinShim
import           Data.Aeson             hiding (Array, String)
import qualified Data.Aeson             as Aeson
import qualified Data.Aeson.Encoding    as AesonEnc
import qualified Data.Binary            as Binary
import           Data.Bits
import qualified Data.ByteArray         as ByteArray
import           Data.ByteString        (ByteString)
import qualified Data.ByteString        as ByteString
import qualified Data.ByteString.Base16 as Base16
import qualified Data.ByteString.Char8  as Char8
import qualified Data.ByteString.Lazy   as Lazy
import           Data.Either.Extra      (maybeToEither)
import           Data.Map.Strict        (Map)
import qualified Data.Map.Strict        as M
import           Data.Maybe
import           Data.RLP
import qualified Data.RLP               as RLP (RLPObject(..))
import           Data.Swagger
import           Data.Text              (Text)
import qualified Data.Text              as Text
import           Data.Time
import           Data.Word
import           Database.Persist.Sql
import           Generic.Random
import           GHC.Generics
import           Numeric
import           Numeric.Natural
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck        hiding ((.&.))
import           Test.QuickCheck.Instances    ()
import           Text.Read              hiding (String)
import           Text.Read.Lex
import           Web.FormUrlEncoded     hiding (fieldLabelModifier)

import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Gas
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Nonce
import           Blockchain.Strato.Model.SHA (shaToHex)
import           Blockchain.Strato.Model.Wei

lastWord64 :: Word256 -> Word64
lastWord64 x = fromIntegral (x .&. 0xffffffffffffffff)

instance ToSchema Word256 where
  declareNamedSchema _ = return $
    NamedSchema (Just "Word256")
      ( mempty
        & type_ .~ SwaggerString
        & example ?~ "ec41a0a4da1f33ee9a757f4fd27c2a1a57313353375860388c66edc562ddc781"
        & description ?~ "Fixed-size words of 256 bits" )

newtype Hex n = Hex { unHex :: n } deriving (Eq, Generic, Ord)

instance (Integral n, Show n) => Show (Hex n) where
  show (Hex n) = showHex (toInteger n) ""

instance (Eq n, Num n) => Read (Hex n) where
  readPrec = Hex <$> readP_to_Prec (const readHexP)
  --I'm not sure what `d` precision parameter is used for

instance Num n => FromJSON (Hex n) where
  parseJSON value = do
    string <- parseJSON value
    case fmap fromInteger (readMaybe ("0x" ++ string)) of
      Nothing -> fail $ "not hex encoded: " ++ string
      Just n  -> return $ Hex n

instance (Integral n, Show n) => ToJSON (Hex n) where
  toJSON = toJSON . show

instance (Integral n, Show n) => ToHttpApiData (Hex n) where
  toUrlPiece = Text.pack . show

instance Arbitrary x => Arbitrary (Hex x) where
  arbitrary = genericArbitrary uniform

instance PersistField Address where
  toPersistValue = PersistText . Text.pack . addressString
  fromPersistValue (PersistText t) = maybeToEither "could not decode address"
                                   . stringAddress
                                   . Text.unpack $ t
  fromPersistValue x = Left . Text.pack
                     $ "PersistField Address: expected PersistText: " ++ show x


instance PersistFieldSql Address where
  sqlType _ = SqlOther "text"

padZeros :: Int -> String -> String
padZeros n string = replicate (n - length string) '0' ++ string

show256 :: Word256 -> String
show256 = padZeros 64 . flip showHex ""

addressString :: Address -> String
addressString = formatAddress

unAddress :: Address -> Word160
unAddress (Address n) = n

instance FromHttpApiData Address where
  parseUrlPiece text = case stringAddress (Text.unpack text) of
    Nothing      -> Left $ "Could not decode Address: " <> text
    Just address -> Right address

instance ToForm Address where
  toForm address = [("address", toQueryParam address)]

instance FromForm Address where fromForm = parseUnique "address"

instance ToSample Address where
  toSamples _ = samples [Address 0xdeadbeef, Address 0x12345678]

instance ToCapture (Capture "address" Address) where
  toCapture _ = DocCapture "address" "an Ethereum address"

instance ToCapture (Capture "contractAddress" Address) where
  toCapture _ = DocCapture "contractAddress" "an Ethereum address"

instance RLPEncodable Address where
  rlpEncode addr = rlpEncode . fst . Base16.decode . Char8.pack $ addressString addr
  rlpDecode obj = Address . fromInteger <$> rlpDecode obj

instance RLPEncodable (Maybe Address) where
  rlpEncode = maybe rlp0 rlpEncode
  rlpDecode x = if x == rlp0 then return Nothing else Just <$> rlpDecode x

instance ToCapture (Capture "userAddress" Address) where
  toCapture _ = DocCapture "userAddress" "an Ethereum address"

instance ToParamSchema Address where
  toParamSchema _ = mempty
    & type_ .~ SwaggerString
    & minimum_ ?~ fromInteger (toInteger . unAddress $ (minBound :: Address))
    & maximum_ ?~ fromInteger (toInteger . unAddress $ (maxBound :: Address))
    & format ?~ "hex string"

instance ToSchema Address where
  declareNamedSchema _ = return $
    NamedSchema (Just "Address")
      ( mempty
        & type_ .~ SwaggerString
        & example ?~ "address=deadbeef" --toJSON (Address 0xdeadbeef) -- FIXME if causing troubles outside /faucet
        & description ?~ "Ethereum Address, 20 byte hex encoded string" )

deriveAddress :: PubKey -> Address
deriveAddress = keccak256Address . ByteString.drop 1 . exportPubKey False


instance RLPEncodable CodePtr where
  rlpEncode (EVMCode codeHash) = rlpEncode $ shaKeccak256 codeHash
  rlpEncode (SolidVMCode n ch) = RLP.Array [RLP.String $ Char8.pack "SolidVM"
                                           , rlpEncode n
                                           , rlpEncode $ shaKeccak256 ch
                                           ]

  rlpDecode (RLP.Array [RLP.String "SolidVM", n, ch]) = SolidVMCode <$> rlpDecode n <*> (keccak256SHA <$> rlpDecode ch)
  rlpDecode ch = EVMCode . keccak256SHA <$> rlpDecode ch

--------------------------------------------------------------------------------

newtype ChainId = ChainId { unChainId :: Word256 }
  deriving (Eq, Ord, Generic, Bounded)
  deriving anyclass (NFData, Binary.Binary)

instance Show ChainId where show = chainIdString

instance ToJSONKey ChainId where
  toJSONKey = ToJSONKeyText f g
    where f x = Text.pack $ chainIdString x
          g x = AesonEnc.text . Text.pack $ chainIdString x

instance PersistField ChainId where
  toPersistValue = PersistText . Text.pack . chainIdString
  fromPersistValue (PersistText t) = maybeToEither "could not decode chainid"
                                   . stringChainId
                                   . Text.unpack $ t
  fromPersistValue x = Left . Text.pack
                     $ "PersistField ChainId: expected PersistText: " ++ show x

instance PersistFieldSql ChainId where
  sqlType _ = SqlOther "text"

chainIdString :: ChainId -> String
chainIdString = show256 . unChainId

stringChainId :: String -> Maybe ChainId
stringChainId string = ChainId . fromInteger <$> readMaybe ("0x" ++ string)

instance ToJSON ChainId where toJSON = toJSON . chainIdString

instance FromJSON ChainId where
  parseJSON value = do
    string <- parseJSON value
    case stringChainId string of
      Nothing      -> fail $ "Could not decode ChainId: " <> string
      Just chainId -> return chainId

instance ToHttpApiData ChainId where
  toUrlPiece = Text.pack . chainIdString

instance FromHttpApiData ChainId where
  parseUrlPiece text = case stringChainId (Text.unpack text) of
    Nothing      -> Left $ "Could not decode ChainId: " <> text
    Just chainId -> Right chainId

instance ToForm ChainId where
  toForm chainId = [("chainid", toQueryParam chainId)]

instance FromForm ChainId where fromForm = parseUnique "chainid"

instance Arbitrary ChainId where
  arbitrary = ChainId . fromInteger <$> arbitrary

instance ToSample ChainId where
  toSamples _ = samples [ChainId 0xdeadbeef, ChainId 0x12345678]

instance ToCapture (Capture "chainid" ChainId) where
  toCapture _ = DocCapture "chainid" "a private chain Id"

instance RLPEncodable ChainId where
  rlpEncode (ChainId n) = rlpEncode $ toInteger n
  rlpDecode obj = ChainId . fromInteger <$> rlpDecode obj

instance ToParam (QueryParam "chainid" ChainId) where
  toParam _ = DocQueryParam "chainid" [] "Blockchain Identifier" Normal

instance ToParamSchema ChainId where
  toParamSchema _ = mempty
    & type_ .~ SwaggerString
    & minimum_ ?~ fromInteger (toInteger . unChainId $ (minBound :: ChainId))
    & maximum_ ?~ fromInteger (toInteger . unChainId $ (maxBound :: ChainId))
    & format ?~ "hex string"

instance ToSchema ChainId where
  declareNamedSchema _ = return $
    NamedSchema (Just "ChainId")
      ( mempty
        & type_ .~ SwaggerString
        & example ?~ "ec41a0a4da1f33ee9a757f4fd27c2a1a57313353375860388c66edc562ddc781"
        & description ?~ "Private chain id, 32 byte hex encoded string" )

newSecKey :: IO SecKey
newSecKey = fromMaybe err . secKey <$> getEntropy 32
  where
    err = error "could not generate secret key"
--------------------------------------------------------------------------------




data AccountState = AccountState
  { accountStateNonce       :: Nonce
  , accountStateBalance     :: Wei
  , accountStateStorageRoot :: Keccak256
  , accountStateCodeHash    :: Keccak256
  , accountStateChainId     :: Maybe ChainId
  } deriving (Eq,Show,Generic)

data Transaction = Transaction
  { transactionNonce      :: Nonce
  , transactionGasPrice   :: Wei
  , transactionGasLimit   :: Gas
  , transactionTo         :: Maybe Address
  , transactionValue      :: Wei
  , transactionInitOrData :: ByteString
  , transactionChainId    :: Maybe ChainId
  , transactionV          :: Word8
  , transactionR          :: Word256
  , transactionS          :: Word256
  , transactionMetadata   :: Maybe (Map Text Text)
  } deriving (Eq,Show,Generic, NFData)

instance RLPEncodable Text where
  rlpEncode = rlpEncode . Text.unpack
  rlpDecode = fmap Text.pack . rlpDecode

instance (Ord k, RLPEncodable k, RLPEncodable v) => RLPEncodable (Map k v) where
  rlpEncode = rlpEncode . M.toList
  rlpDecode = fmap M.fromList <$> rlpDecode

instance RLPEncodable Transaction where
  rlpEncode Transaction{..} = Array $
    [ rlpEncode transactionNonce
    , rlpEncode transactionGasPrice
    , rlpEncode transactionGasLimit
    , rlpEncode transactionTo
    , rlpEncode transactionValue
    , rlpEncode transactionInitOrData
    , rlpEncode transactionV
    , rlpEncode transactionR
    , rlpEncode transactionS
    ] ++ (case transactionChainId of
            Nothing -> []
            Just cid -> [rlpEncode cid])
      ++ (case transactionMetadata of
            Nothing -> []
            Just md -> [rlpEncode md])
  rlpDecode (Array (n:gp:gl:to':va:iod:v':r':s':rest)) =
    let (cid,md) = case rest of
          [] -> (Right Nothing, Right Nothing)
          [c] -> case c of
            a@(Array _) -> (Right Nothing, Just <$> rlpDecode a)
            cid' -> (Just <$> rlpDecode cid', Right Nothing)
          (c:m:_) -> (Just <$> rlpDecode c, Just <$> rlpDecode m)
     in Transaction
          <$> rlpDecode n
          <*> rlpDecode gp
          <*> rlpDecode gl
          <*> rlpDecode to'
          <*> rlpDecode va
          <*> rlpDecode iod
          <*> cid
          <*> rlpDecode v'
          <*> rlpDecode r'
          <*> rlpDecode s'
          <*> md
  rlpDecode x = Left $ "rlpDecode Transaction: Got " ++ show x

data UnsignedTransaction = UnsignedTransaction
  { unsignedTransactionNonce      :: Nonce
  , unsignedTransactionGasPrice   :: Wei
  , unsignedTransactionGasLimit   :: Gas
  , unsignedTransactionTo         :: Maybe Address
  , unsignedTransactionValue      :: Wei
  , unsignedTransactionInitOrData :: ByteString
  , unsignedTransactionChainId    :: Maybe ChainId
  } deriving (Eq,Show,Generic)

instance Arbitrary UnsignedTransaction where
  arbitrary = genericArbitrary uniform

instance RLPEncodable UnsignedTransaction where
  rlpEncode UnsignedTransaction{..} = Array $
    [ rlpEncode unsignedTransactionNonce
    , rlpEncode unsignedTransactionGasPrice
    , rlpEncode unsignedTransactionGasLimit
    , rlpEncode unsignedTransactionTo
    , rlpEncode unsignedTransactionValue
    , rlpEncode unsignedTransactionInitOrData
    ] ++ (maybeToList $ fmap rlpEncode unsignedTransactionChainId)
  rlpDecode (Array (n:gp:gl:to':va:iod:rest)) =
    UnsignedTransaction
      <$> rlpDecode n
      <*> rlpDecode gp
      <*> rlpDecode gl
      <*> rlpDecode to'
      <*> rlpDecode va
      <*> rlpDecode iod
      <*> (case rest of
             [] -> pure Nothing
             [cid] -> Just <$> rlpDecode cid
             x -> Left $ "rlpDecode UnsignedTransaction: Too many entries, got: " ++ show x)
  rlpDecode x = Left $ "rlpDecode UnsignedTransaction: Got " ++ show x

rlpMsg :: RLPEncodable x => x -> Msg
rlpMsg
  = fromMaybe (error "rlpMsg failure")
  . msg
  . bytesToWord256
  . rlpHash

rlpHash :: RLPEncodable x => x -> ByteString
rlpHash
  = ByteArray.convert
  . digestKeccak256
  . keccak256
  . packRLP
  . rlpEncode

signTransaction :: SecKey -> UnsignedTransaction -> Transaction
signTransaction = signTransactionWithMetadata Nothing

signTransactionWithMetadata :: Maybe (Map Text Text)
                            -> SecKey
                            -> UnsignedTransaction
                            -> Transaction
signTransactionWithMetadata md sk u@UnsignedTransaction{..} =
  Transaction
    { transactionNonce = unsignedTransactionNonce
    , transactionGasPrice = unsignedTransactionGasPrice
    , transactionGasLimit = unsignedTransactionGasLimit
    , transactionTo = unsignedTransactionTo
    , transactionValue = unsignedTransactionValue
    , transactionV = testV + 0x1b
    , transactionR = r
    , transactionS = s
    , transactionInitOrData = unsignedTransactionInitOrData
    , transactionChainId = unsignedTransactionChainId
    , transactionMetadata = md
    }
  where
    CompactRecSig r s testV =
      exportCompactRecSig
      . signRecMsg sk
      $ rlpMsg u

unsignTransaction :: Transaction -> UnsignedTransaction
unsignTransaction Transaction{..} = UnsignedTransaction
  { unsignedTransactionNonce = transactionNonce
  , unsignedTransactionGasPrice = transactionGasPrice
  , unsignedTransactionGasLimit = transactionGasLimit
  , unsignedTransactionTo = transactionTo
  , unsignedTransactionValue = transactionValue
  , unsignedTransactionInitOrData = transactionInitOrData
  , unsignedTransactionChainId = transactionChainId
  }

verifyTransaction :: PubKey -> Transaction -> Bool
verifyTransaction pk t@Transaction{transactionR = r, transactionS = s} =
  let
    message = rlpMsg $ unsignTransaction t
  in
    case importCompactSig (CompactSig r s) of
      Nothing  -> False
      Just sig -> verifySig pk sig message

recoverTransaction :: Transaction -> Maybe PubKey
recoverTransaction t@Transaction{transactionR = r, transactionS = s, transactionV = v} = do
  let
    message = rlpMsg $ unsignTransaction t
    v' = v - 0x1b
    compactRecSig = CompactRecSig r s v'
  recSig <- importCompactRecSig compactRecSig
  recover recSig message

transactionFrom :: Transaction -> Maybe Address
transactionFrom = fmap deriveAddress . recoverTransaction

-- | Yellow Paper (82)
newAccountAddress :: Transaction -> Address
newAccountAddress Transaction{..}
  = keccak256Address $ rlpSerialize (transactionTo, transactionNonce)

data BlockHeader = BlockHeader
  { blockHeaderParentHash       :: Keccak256
  , blockHeaderOmmersHash       :: Keccak256
  , blockHeaderBeneficiary      :: Address
  , blockHeaderStateRoot        :: Keccak256
  , blockHeaderTransactionsRoot :: Keccak256
  , blockHeaderReceiptsRoot     :: Keccak256
  , blockHeaderLogsBloom        :: BloomFilter
  , blockHeaderDifficulty       :: Natural
  , blockHeaderNumber           :: Natural
  , blockHeaderGasLimit         :: Gas
  , blockHeaderGasUsed          :: Gas
  , blockHeaderTimeStamp        :: UTCTime
  , blockHeaderExtraData        :: Word256
  , blockHeaderMixHash          :: Keccak256
  , blockHeaderNonce            :: Nonce
  , blockHeaderChainId          :: Maybe Word256
  } deriving (Eq,Show,Generic)



newtype BloomFilter = BloomFilter ByteString deriving (Eq, Show, Generic)

data CodeInfo = CodeInfo
  { codeInfoCode   :: Text
  , codeInfoSource :: Text
  , codeInfoName   :: Text
  } deriving (Show, Read, Eq, Generic)

instance FromJSON CodeInfo where
  parseJSON (Object o) =
    CodeInfo
    <$> o .: "code"
    <*> o .: "src"
    <*> o .: "name"
  parseJSON _ = error "parseJSON CodeInfo: expected Object"

instance ToJSON CodeInfo where
  toJSON (CodeInfo bs s1 s2) = object
    [ "code" Aeson..= bs
    , "src"  Aeson..= s1
    , "name" Aeson..= s2
    ]

instance ToSchema CodeInfo where
  declareNamedSchema _ = return $
    NamedSchema (Just "CodeInfo")
      ( mempty
        & type_ .~ SwaggerInteger
        & example ?~ toJSON (CodeInfo "ContractBin" "ContractSrc" "ContractName")
        & description ?~ "Code Info" )

data AccountInfo = NonContract Address Integer
                 | ContractNoStorage Address Integer CodePtr
                 | ContractWithStorage Address Integer CodePtr (Map Word256 Word256)
   deriving (Show, Eq, Generic)

instance ToJSON AccountInfo where
  toJSON (NonContract a b) = object
    [ "address" Aeson..= a
    , "balance" Aeson..= b
    ]
  toJSON (ContractNoStorage a b c) = object
    [ "address" Aeson..= a
    , "balance" Aeson..= b
    , "codeHash" Aeson..= c
    ]
  toJSON (ContractWithStorage a b c s) = object
    [ "address" Aeson..= a
    , "balance" Aeson..= b
    , "codeHash" Aeson..= c
    , "storage" Aeson..= (map (\(w1,w2) -> (show256 w1, show256 w2)) $ M.toList s) -- TODO(dustin): This Hex newtype doesn't seem to work for tuples :/
    ]

instance FromJSON AccountInfo where
  parseJSON (Object o) = do
    a <- (o .: "address")
    b <- (o .: "balance")
    mc <- (o .:? "codeHash")
    case mc of
      Nothing -> return $ NonContract a b
      Just c -> do
        ms <- (o .:? "storage")
        case ms of
          Nothing -> return $ ContractNoStorage a b c
          Just s' -> do
            let s = M.fromList $ map (\(h1,h2) -> (unHex h1, unHex h2)) s'
            return $ ContractWithStorage a b c s
  parseJSON o = error $ "parseJSON AccountInfo: Expected object, got: " ++ show o

instance ToSchema AccountInfo where
  declareNamedSchema _ = return $
    NamedSchema (Just "AccountInfo")
      ( mempty
        & type_ .~ SwaggerInteger
        & example ?~ toJSON (NonContract (Address 0x5815b9975001135697b5739956b9a6c87f1c575c) (20000000 :: Integer))
        & description ?~ "Account Info" )



keccak256Address :: ByteString -> Address
keccak256Address
  = Address
  . Binary.decode
  . Lazy.fromStrict
  . ByteString.drop 12
  . ByteArray.convert
  . digestKeccak256
  . keccak256
