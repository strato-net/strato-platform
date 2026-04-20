{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveFoldable #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveTraversable #-}
{-# LANGUAGE FlexibleInstances #-}

module SolidVM.Model.CodeCollection.Yul
  ( InlineAssemblyF (..),
    InlineAssembly,
    YulStatementF (..),
    YulStatement,
    extractYulStatement,
    YulExpressionF (..),
    YulExpression,
    extractYulExpression,
    YulTypedNameF (..),
    YulTypedName,
    extractYulTypedName,
    YulLiteral (..),
  )
where

import Control.DeepSeq
import Data.Aeson
import Data.Binary
import Data.Source
import GHC.Generics
import qualified Generic.Random as GR
import SolidVM.Model.SolidString
import Test.QuickCheck
import Test.QuickCheck.Instances ()

-- | A Yul literal is the terminal form of a Yul expression.
-- Numbers include decimal and hex; strings are arbitrary and used
-- both for string-literals and for @hex"..."@ literals (the parser
-- canonicalizes hex literals to a hex-encoded string).
data YulLiteral
  = YulNumber !Integer
  | YulString !String
  | YulHexString !String -- pre-hex-decoded so interpreter can re-parse cheaply
  | YulBool !Bool
  deriving (Show, Eq, Generic, NFData)

instance Binary YulLiteral

instance ToJSON YulLiteral

instance FromJSON YulLiteral

instance Arbitrary YulLiteral where
  arbitrary = GR.genericArbitrary GR.uniform

-- | A typed Yul identifier: the optional type is only used for pretty-
-- printing and static analysis; the interpreter treats all Yul values
-- as 256-bit words.
data YulTypedNameF a = YulTypedName
  { yulTypedName :: SolidString,
    yulTypedNameType :: Maybe SolidString,
    yulTypedNameContext :: a
  }
  deriving (Show, Eq, Generic, Functor, NFData, Foldable, Traversable)

type YulTypedName = Positioned YulTypedNameF

instance Binary a => Binary (YulTypedNameF a)

instance ToJSON a => ToJSON (YulTypedNameF a)

instance FromJSON a => FromJSON (YulTypedNameF a)

instance Arbitrary a => Arbitrary (YulTypedNameF a) where
  arbitrary = GR.genericArbitrary GR.uniform

extractYulTypedName :: YulTypedNameF a -> a
extractYulTypedName = yulTypedNameContext

-- | Yul expressions. All Yul operators surface as 'YulFunctionCall' --
-- the interpreter dispatches on the identifier name.
data YulExpressionF a
  = YulIdentifier a SolidString
  | YulFunctionCall a SolidString [YulExpressionF a]
  | YulLit a YulLiteral
  deriving (Show, Eq, Generic, Functor, NFData, Foldable, Traversable)

type YulExpression = Positioned YulExpressionF

instance Binary a => Binary (YulExpressionF a)

instance ToJSON a => ToJSON (YulExpressionF a)

instance FromJSON a => FromJSON (YulExpressionF a)

extractYulExpression :: YulExpressionF a -> a
extractYulExpression (YulIdentifier a _) = a
extractYulExpression (YulFunctionCall a _ _) = a
extractYulExpression (YulLit a _) = a

-- | Yul statements. A Yul block is represented as 'YulBlock'.
-- Switch cases are @(literal, body)@; the optional final body is the
-- @default@ clause.
data YulStatementF a
  = YulBlock a [YulStatementF a]
  | YulLet a [YulTypedNameF a] (Maybe (YulExpressionF a))
  | YulAssign a [SolidString] (YulExpressionF a)
  | YulIfStmt a (YulExpressionF a) [YulStatementF a]
  | YulSwitch a (YulExpressionF a) [(YulLiteral, [YulStatementF a])] (Maybe [YulStatementF a])
  | YulFor a [YulStatementF a] (YulExpressionF a) [YulStatementF a] [YulStatementF a]
  | YulBreak a
  | YulContinue a
  | YulLeave a
  | YulExpressionStatement a (YulExpressionF a)
  | YulFunctionDef
      a
      SolidString
      [YulTypedNameF a] -- parameters
      [YulTypedNameF a] -- returns
      [YulStatementF a] -- body
  deriving (Show, Eq, Generic, Functor, NFData, Foldable, Traversable)

type YulStatement = Positioned YulStatementF

instance Binary a => Binary (YulStatementF a)

instance ToJSON a => ToJSON (YulStatementF a)

instance FromJSON a => FromJSON (YulStatementF a)

extractYulStatement :: YulStatementF a -> a
extractYulStatement (YulBlock a _) = a
extractYulStatement (YulLet a _ _) = a
extractYulStatement (YulAssign a _ _) = a
extractYulStatement (YulIfStmt a _ _) = a
extractYulStatement (YulSwitch a _ _ _) = a
extractYulStatement (YulFor a _ _ _ _) = a
extractYulStatement (YulBreak a) = a
extractYulStatement (YulContinue a) = a
extractYulStatement (YulLeave a) = a
extractYulStatement (YulExpressionStatement a _) = a
extractYulStatement (YulFunctionDef a _ _ _ _) = a

-- | The outer wrapper for an @assembly { ... }@ block. Kept as a separate
-- type (rather than inlining @[YulStatementF a]@ in 'StatementF') so that
-- future metadata (e.g. @"evmasm"@ flag, memory-safety annotations) can
-- be added without churning every pattern match.
newtype InlineAssemblyF a = InlineAssembly
  { yulBody :: [YulStatementF a]
  }
  deriving (Show, Eq, Generic, Functor, NFData, Foldable, Traversable)

type InlineAssembly = Positioned InlineAssemblyF

instance Binary a => Binary (InlineAssemblyF a)

instance ToJSON a => ToJSON (InlineAssemblyF a)

instance FromJSON a => FromJSON (InlineAssemblyF a)

instance Arbitrary a => Arbitrary (YulExpressionF a) where
  arbitrary =
    oneof
      [ YulIdentifier <$> arbitrary <*> pure "x",
        YulLit <$> arbitrary <*> arbitrary
      ]

instance Arbitrary a => Arbitrary (YulStatementF a) where
  arbitrary =
    oneof
      [ YulBreak <$> arbitrary,
        YulContinue <$> arbitrary,
        YulLeave <$> arbitrary,
        YulExpressionStatement <$> arbitrary <*> arbitrary
      ]

instance Arbitrary a => Arbitrary (InlineAssemblyF a) where
  arbitrary = InlineAssembly <$> arbitrary
