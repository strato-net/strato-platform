{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

module Common.Encoder where

import Prelude hiding (id, (.))
import Control.Category
import Control.Lens
import Control.Monad ((<=<))
import Data.Default
import qualified Data.Map.Strict as M
import Data.Maybe (mapMaybe)
import Data.Text (Text)
import qualified Data.Text as T
import GHC.Generics (Generic)

data RoutePath = RoutePath
  { _rpPath :: [Text]
  , _rpQuery :: [(Text, Maybe Text)]
  } deriving (Eq, Show, Generic)

instance Default RoutePath where
  def = RoutePath [] []

instance Semigroup RoutePath where
  (RoutePath p1 q1) <> (RoutePath p2 q2) =
    RoutePath (p1 <> p2) (q1 <> q2)

instance Monoid RoutePath where
  mempty = def
  mappend = (<>)

makeLenses ''RoutePath

data Encoder' d e = Encoder
  { _encode :: d -> e
  , _decode :: e -> Maybe d
  }

instance Category Encoder' where
  id = Encoder id Just
  (Encoder e1 d1) . (Encoder e2 d2) =
    Encoder (e1 . e2) (d2 <=< d1)

makeLenses ''Encoder'

type Encoder r = Encoder' r RoutePath

type Serializer r = Encoder' r Text

enumEncoder :: (Enum r, Bounded r) => (r -> Text) -> Encoder r
enumEncoder f =
  let preimage = M.fromList $ (\r -> (f r, r)) <$> [minBound..maxBound]
      enc = Encoder f (flip M.lookup preimage)
   in pathEndEncoder . enc

pathEndEncoder :: Encoder Text
pathEndEncoder = Encoder
  (\t -> RoutePath [t] [])
  (\(RoutePath p q) -> case (p,q) of
    ([t], _) -> Just t
    _        -> Nothing
  )

encodeUriElement :: Text -> Text
encodeUriElement = id

encodePath :: [Text] -> Text
encodePath p = "/" <> T.intercalate "/" (encodeUriElement <$> p)

encodeQueryPiece :: Text -> Maybe Text -> Text
encodeQueryPiece q Nothing  = encodeUriElement q
encodeQueryPiece q (Just v) = encodeUriElement q <> "=" <> encodeUriElement v

encodeQuery :: [(Text, Maybe Text)] -> Text
encodeQuery [] = ""
encodeQuery q  = "?" <> T.intercalate "&" (uncurry encodeQueryPiece <$> q)

encodeRoutePath :: RoutePath -> Text
encodeRoutePath (RoutePath p q) = encodePath p <> encodeQuery q

decodeUriElement :: Text -> Text
decodeUriElement = id

decodePathPiece :: Text -> Maybe Text
decodePathPiece p = if T.null p
  then Nothing
  else Just $ decodeUriElement p

decodePath :: Text -> [Text]
decodePath p = mapMaybe decodePathPiece $ T.splitOn "/" p

decodeQueryPiece :: Text -> Maybe (Text, Maybe Text)
decodeQueryPiece q = case T.splitOn "=" q of
  [q']    -> Just (decodeUriElement q', Nothing)
  [q',v'] -> Just (decodeUriElement q', Just $ decodeUriElement v')
  _       -> Nothing

decodeQuery :: Text -> Maybe [(Text, Maybe Text)]
decodeQuery "" = Just []
decodeQuery q  = traverse decodeQueryPiece $ T.splitOn "&" q

decodeRoutePath :: Text -> Maybe RoutePath
decodeRoutePath pq = case T.splitOn "?" pq of
  [p]   -> Just $ RoutePath (decodePath p) []
  [p,q] -> RoutePath (decodePath p) <$> decodeQuery q
  _     -> Nothing

routePathEncoder :: Encoder' RoutePath Text
routePathEncoder = Encoder encodeRoutePath decodeRoutePath
