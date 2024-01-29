{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Data.Source.Annotation
  ( SourceAnnotation (..),
    Positioned,
    Annotated,
    parseErrorToAnnotation,
    withAnnotation,
    withPosition,
    position,
    emptySourceAnnotation,
    typeErrorToAnnotation,
    sourceAnnotationStart,
    sourceAnnotationEnd,
    sourceAnnotationAnnotation,
  )
where

import Control.DeepSeq
import Control.Lens hiding ((.=))
import Data.Aeson as Aeson
import Data.Binary
import Data.Data
import Data.Default
import qualified Data.Map as M
import Data.Source.Position
import Data.Swagger
import Data.Text (Text, pack)
import qualified Data.Text as T
import GHC.Generics
import Test.QuickCheck
import Test.QuickCheck.Instances ()
import Text.Parsec (ParsecT)
import Text.Parsec.Error

data SourceAnnotation a = SourceAnnotation
  { _sourceAnnotationStart :: SourcePosition,
    _sourceAnnotationEnd :: SourcePosition,
    _sourceAnnotationAnnotation :: a
  }
  deriving (Eq, Ord, Generic, Functor, Data, NFData)

makeLenses ''SourceAnnotation

instance Binary a => Binary (SourceAnnotation a)

instance ToJSON a => ToJSON (SourceAnnotation a) where
  toJSON ann =
    object
      [ "start" .= _sourceAnnotationStart ann,
        "end" .= _sourceAnnotationEnd ann,
        "annotation" .= _sourceAnnotationAnnotation ann
      ]

instance FromJSON a => FromJSON (SourceAnnotation a) where
  parseJSON (Object o) = do
    start <- o .: "start"
    end <- o .: "end"
    ann <- o .: "annotation"
    pure $ SourceAnnotation start end ann
  parseJSON o = fail $ "parseJSON SourceAnnotation: expected Object, got " ++ show o

instance Arbitrary a => Arbitrary (SourceAnnotation a) where
  arbitrary = SourceAnnotation <$> arbitrary <*> arbitrary <*> arbitrary

instance Default a => Default (SourceAnnotation a) where
  def = SourceAnnotation def def def

instance ToSchema (SourceAnnotation a) where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "SourceAnnotation")
        ( mempty
            & type_ ?~ SwaggerString
            & example
              ?~ toJSON
                ( SourceAnnotation
                    (SourcePosition "A.sol" 41 0)
                    (SourcePosition "A.sol" 41 13)
                    ("Unknown identifier: centralization" :: Text)
                )
            & description ?~ "SourceAnnotation"
        )

instance Semigroup a => Semigroup (SourceAnnotation a) where
  (SourceAnnotation s _ a) <> (SourceAnnotation _ e b) = SourceAnnotation s e (a <> b)

instance Show a => Show (SourceAnnotation a) where
  show sAT =
    concat
      [ file,
        " (line ",
        show startPosLine,
        ", column ",
        show startPosColumn,
        ") - (line ",
        show endPosLine,
        ", column ",
        show endPosColumn,
        "): ",
        show sAA,
        " "
      ]
    where
      startPos = (_sourceAnnotationStart sAT)
      file = startPos ^. sourcePositionName
      endPos = (_sourceAnnotationEnd sAT)
      sAA = (_sourceAnnotationAnnotation sAT)
      startPosLine = (_sourcePositionLine startPos)
      startPosColumn = (_sourcePositionColumn startPos)
      endPosLine = (_sourcePositionLine endPos)
      endPosColumn = (_sourcePositionColumn endPos)

type Positioned f = f (SourceAnnotation ())

type Annotated f = f (SourceAnnotation Text)

emptySourceAnnotation :: SourceAnnotation ()
emptySourceAnnotation = SourceAnnotation (initialPosition "") (initialPosition "") ()

parseErrorToAnnotation :: ParseError -> SourceAnnotation Text
parseErrorToAnnotation pe =
  let msgs = errorMessages pe
      sp = toSourcePosition $ errorPos pe
      ann =
        showErrorMessages
          "or"
          "unknown parse error"
          "expecting"
          "unexpected"
          "end of input"
          msgs
   in SourceAnnotation sp sp $ pack ann

typeErrorToAnnotation :: [SourceAnnotation Text] -> Text
typeErrorToAnnotation sats = T.pack $ turnToString sats M.empty
  where
    turnToString [] mapSAT = concat (map fst $ M.toList mapSAT)
    turnToString (x : xs) mapSAT = turnToString xs (M.insert (show x) x mapSAT)

withAnnotation ::
  Monad m =>
  a ->
  ParsecT s u m b ->
  ParsecT s u m (SourceAnnotation a, b)
withAnnotation a p = do
  s <- getSourcePosition
  p' <- p
  e <- getSourcePosition
  pure (SourceAnnotation s e a, p')

withPosition ::
  Monad m =>
  ParsecT s u m b ->
  ParsecT s u m (SourceAnnotation (), b)
withPosition = withAnnotation ()

position ::
  Monad m =>
  ParsecT s u m a ->
  ParsecT s u m (SourceAnnotation ())
position = fmap fst . withPosition
