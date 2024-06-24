{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveFoldable #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveTraversable #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TypeSynonymInstances #-}

module SolidVM.Model.CodeCollection.Statement
  ( StatementF (..),
    extractStatement,
    Statement,
    Location (..),
    VarDefEntryF (..),
    VarDefEntry,
    vardefLocation,
    getVarDefType,
    getVarDefContext,
    SimpleStatementF (..),
    SimpleStatement,
    InlineAssembly (..),
    ExpressionF (..),
    extractExpression,
    Expression,
    ArgListF (..),
    ArgList,
    NumberUnit (..),
    numLitGen,
    WrappedDecimal (..),
  )
where

import Blockchain.Strato.Model.Account
--import Data.Swagger

import Control.DeepSeq
import Data.Aeson
import Data.Binary
import Data.Decimal
import qualified Data.Map.Strict as Map
import Data.Source
import qualified Data.Text as T
import GHC.Generics
import qualified Generic.Random as GR
import SolidVM.Model.SolidString
import SolidVM.Model.Type hiding (Decimal)
import Test.QuickCheck
import Test.QuickCheck.Instances ()

-- Changes to this structure should also have changes in the Unparser :)
data StatementF a
  = IfStatement (ExpressionF a) [StatementF a] (Maybe [StatementF a]) a -- if then else
  | WhileStatement (ExpressionF a) [StatementF a] a
  | ForStatement (Maybe (SimpleStatementF a)) (Maybe (ExpressionF a)) (Maybe (ExpressionF a)) [StatementF a] a
  | Block a
  | DoWhileStatement [StatementF a] (ExpressionF a) a
  | Continue a
  | Break a
  | Return (Maybe (ExpressionF a)) a
  | Throw (ExpressionF a) a
  | ModifierExecutor a
  | EmitStatement String [(Maybe String, (ExpressionF a))] a
  | AssemblyStatement InlineAssembly a
  | SimpleStatement (SimpleStatementF a) a
  | RevertStatement (Maybe String) (ArgListF a) a
  | UncheckedStatement [StatementF a] a
  | SolidityTryCatchStatement (ExpressionF a) (Maybe [(String, Type)]) [StatementF a] (Map.Map String (Maybe (String, Type), [StatementF a])) a
  | TryCatchStatement [StatementF a] (Map.Map String (Maybe [String], [StatementF a])) a
  deriving (Show, Eq, Generic, Functor, NFData, ToJSON, FromJSON, Foldable, Traversable)

instance Binary a => Binary (StatementF a)

extractStatement :: StatementF a -> a
extractStatement (IfStatement _ _ _ a) = a
extractStatement (WhileStatement _ _ a) = a
extractStatement (ForStatement _ _ _ _ a) = a
extractStatement (Block a) = a
extractStatement (DoWhileStatement _ _ a) = a
extractStatement (Continue a) = a
extractStatement (Break a) = a
extractStatement (Return _ a) = a
extractStatement (Throw _ a) = a
extractStatement (EmitStatement _ _ a) = a
extractStatement (AssemblyStatement _ a) = a
extractStatement (SimpleStatement _ a) = a
extractStatement (RevertStatement _ _ a) = a
extractStatement (UncheckedStatement _ a) = a
extractStatement (ModifierExecutor a) = a
extractStatement (TryCatchStatement _ _ a) = a
extractStatement (SolidityTryCatchStatement _ _ _ _ a) = a

type Statement = Positioned StatementF

data Location = Memory | Storage | Calldata deriving (Show, Eq, Generic, NFData)

instance Binary Location

instance ToJSON Location

instance FromJSON Location

instance Arbitrary Location where
  arbitrary = GR.genericArbitrary GR.uniform

data VarDefEntryF a
  = BlankEntry
  | VarDefEntry
      { vardefType :: Maybe Type,
        _vardefLocation :: Maybe Location,
        vardefName :: SolidString,
        vardefContext :: a
      }
  deriving (Show, Eq, Generic, Functor, NFData, Foldable, Traversable)

type VarDefEntry = Positioned VarDefEntryF

instance Binary a => Binary (VarDefEntryF a)

instance ToJSON a => ToJSON (VarDefEntryF a)

instance FromJSON a => FromJSON (VarDefEntryF a)

vardefLocation :: VarDefEntryF a -> Maybe Location
vardefLocation BlankEntry = Nothing
vardefLocation (VarDefEntry _ mLoc _ _) = mLoc

getVarDefType :: VarDefEntryF a -> Maybe Type
getVarDefType (VarDefEntry mTy _ _ _) = mTy
getVarDefType BlankEntry = Nothing

getVarDefContext :: VarDefEntryF a -> Maybe a
getVarDefContext (VarDefEntry _ _ _ a) = Just a
getVarDefContext BlankEntry = Nothing

data SimpleStatementF a
  = VariableDefinition [VarDefEntryF a] (Maybe (ExpressionF a)) -- Nothing type indicates "var" keyword
  | ExpressionStatement (ExpressionF a)
  deriving (Show, Eq, Generic, Functor, NFData, Foldable, Traversable)

type SimpleStatement = Positioned SimpleStatementF

instance Binary a => Binary (SimpleStatementF a)

instance ToJSON a => ToJSON (SimpleStatementF a)

instance FromJSON a => FromJSON (SimpleStatementF a)

-- Currently, the only supported inline assembly is:
-- assembly {
--  result := mload(add(source, 32))
-- }
-- Anything else is a parse error.
data InlineAssembly = MloadAdd32 T.Text T.Text deriving (Show, Eq, Generic, NFData)

instance Binary InlineAssembly

instance ToJSON InlineAssembly

instance FromJSON InlineAssembly

instance Arbitrary InlineAssembly where
  arbitrary = GR.genericArbitrary GR.uniform

data ExpressionF a
  = PlusPlus a (ExpressionF a)
  | MinusMinus a (ExpressionF a)
  | NewExpression a Type
  | IndexAccess a (ExpressionF a) (Maybe (ExpressionF a))
  | MemberAccess a (ExpressionF a) SolidString -- ie- "x.y"
  | FunctionCall a (ExpressionF a) (ArgListF a)
  | Unitary a String (ExpressionF a)
  | Binary a String (ExpressionF a) (ExpressionF a)
  | Ternary a (ExpressionF a) (ExpressionF a) (ExpressionF a)
  | BoolLiteral a Bool
  | NumberLiteral a Integer (Maybe NumberUnit)
  | DecimalLiteral a WrappedDecimal
  | StringLiteral a String
  | AccountLiteral a NamedAccount
  | TupleExpression a [Maybe (ExpressionF a)]
  | ArrayExpression a [(ExpressionF a)]
  | Variable a SolidString
  | ObjectLiteral a (Map.Map SolidString (ExpressionF a))
  | HexaLiteral a SolidString -- if type clash remove ie hex"0F3A"
  deriving (Show, Eq, Generic, Generic1, NFData, Functor, Foldable, Traversable)

extractExpression :: ExpressionF a -> a
extractExpression (PlusPlus a _) = a
extractExpression (MinusMinus a _) = a
extractExpression (NewExpression a _) = a
extractExpression (IndexAccess a _ _) = a
extractExpression (MemberAccess a _ _) = a
extractExpression (FunctionCall a _ _) = a
extractExpression (Unitary a _ _) = a
extractExpression (Binary a _ _ _) = a
extractExpression (Ternary a _ _ _) = a
extractExpression (BoolLiteral a _) = a
extractExpression (NumberLiteral a _ _) = a
extractExpression (DecimalLiteral a _) = a
extractExpression (StringLiteral a _) = a
extractExpression (AccountLiteral a _) = a
extractExpression (TupleExpression a _) = a
extractExpression (ArrayExpression a _) = a
extractExpression (Variable a _) = a
extractExpression (HexaLiteral a _) = a
extractExpression (ObjectLiteral a _) = a

type Expression = Positioned ExpressionF

instance Binary a => Binary (ExpressionF a)

instance ToJSON a => ToJSON (ExpressionF a)

instance FromJSON a => FromJSON (ExpressionF a)

data ArgListF a = OrderedArgs [ExpressionF a] | NamedArgs [(SolidString, (ExpressionF a))]
  deriving (Show, Eq, Generic, NFData, Functor, Foldable, Traversable) --Or String

genPos :: Gen Integer
genPos = abs `fmap` (arbitrary :: Gen Integer) `suchThat` (> 0)

genString :: Gen String
genString = vectorOf 3 $ Test.QuickCheck.elements ['a' .. 'z']

numLitGen :: (Arbitrary a) => Gen (ExpressionF a)
numLitGen =
  frequency
    [ (10, NumberLiteral <$> arbitrary <*> genPos <*> Test.QuickCheck.elements [Just Wei]),
      (1, Binary <$> arbitrary <*> Test.QuickCheck.elements ["+"] <*> scale (`div` 2) numLitGen <*> scale (`div` 2) numLitGen)
    ]

stringLitGen :: (Arbitrary a) => Gen (ExpressionF a)
stringLitGen =
  frequency
    [ (10, StringLiteral <$> arbitrary <*> genString),
      (1, Binary <$> arbitrary <*> Test.QuickCheck.elements ["+"] <*> scale (`div` 2) stringLitGen <*> scale (`div` 2) stringLitGen)
    ]

instance Arbitrary a => Arbitrary (ExpressionF a) where
  arbitrary = oneof [numLitGen, stringLitGen]

instance Arbitrary a => Arbitrary (ArgListF a) where
  arbitrary = GR.genericArbitrary GR.uniform

type ArgList = Positioned ArgListF

instance Binary a => Binary (ArgListF a)

instance ToJSON a => ToJSON (ArgListF a)

instance FromJSON a => FromJSON (ArgListF a)

data NumberUnit = Wei | Szabo | Finney | Ether deriving (Show, Eq, Generic, NFData)

instance Arbitrary NumberUnit where
  arbitrary = GR.genericArbitrary GR.uniform

instance Binary NumberUnit

instance ToJSON NumberUnit

instance FromJSON NumberUnit

instance Arbitrary a => Arbitrary (StatementF a) where
  arbitrary = GR.genericArbitrary GR.uniform

instance Arbitrary a => Arbitrary (SimpleStatementF a) where
  arbitrary = GR.genericArbitrary GR.uniform

instance Arbitrary a => Arbitrary (VarDefEntryF a) where
  arbitrary = GR.genericArbitrary GR.uniform

newtype WrappedDecimal = WrappedDecimal { unwrapDecimal :: DecimalRaw Integer }
    deriving (Show, Eq, Ord, Generic, NFData)

instance Binary WrappedDecimal where
    put (WrappedDecimal (Decimal places mantissa)) = do
        put places
        put mantissa
    
    get = do
        places <- get
        mantissa <- get
        return $ WrappedDecimal (Decimal places mantissa)

instance FromJSON WrappedDecimal where
    parseJSON = withObject "WrappedDecimal" $ \v -> do
        places <- v .: "decimalPlaces"
        mantissa <- v .: "decimalMantissa"
        return $ WrappedDecimal (Decimal places mantissa)

instance ToJSON WrappedDecimal where
    toJSON (WrappedDecimal (Decimal places mantissa)) = object
        [ "decimalPlaces" .= places
        , "decimalMantissa" .= mantissa
        ]
