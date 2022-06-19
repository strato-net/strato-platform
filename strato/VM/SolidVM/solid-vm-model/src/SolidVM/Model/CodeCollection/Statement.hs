{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
module SolidVM.Model.CodeCollection.Statement
  ( StatementF(..)
  , extractStatement
  , Statement
  , Location(..)
  , VarDefEntryF(..)
  , VarDefEntry
  , vardefLocation
  , getVarDefType
  , getVarDefContext
  , SimpleStatementF(..)
  , SimpleStatement
  , InlineAssembly(..)
  , ExpressionF(..)
  , extractExpression
  , Expression
  , ArgListF(..)
  , ArgList
  , NumberUnit(..)
  ) where

import Data.Aeson
import Data.Source
import qualified Data.Map.Strict as Map
import qualified Data.Text as T
import GHC.Generics
import SolidVM.Model.Label
import SolidVM.Model.Type

data StatementF a =
  IfStatement (ExpressionF a) [StatementF a] (Maybe [StatementF a]) a -- if then else
  | WhileStatement (ExpressionF a) [StatementF a] a
  | ForStatement (Maybe (SimpleStatementF a)) (Maybe (ExpressionF a)) (Maybe (ExpressionF a)) [StatementF a] a
  | Block a
  | DoWhileStatement [StatementF a] (ExpressionF a) a
  | Continue a
  | Break a
  | Return (Maybe (ExpressionF a)) a
  | Throw a
  | EmitStatement String [(Maybe String, (ExpressionF a))] a
  | AssemblyStatement InlineAssembly a
  | SimpleStatement (SimpleStatementF a) a
  | RevertStatement (Maybe String) (ArgListF a) a
  | UncheckedStatement [StatementF a] a
  deriving (Show, Eq, Generic, Functor, ToJSON, FromJSON)

extractStatement :: StatementF a -> a
extractStatement (IfStatement _ _ _ a) = a
extractStatement (WhileStatement _ _ a) = a
extractStatement (ForStatement _ _ _ _ a) = a
extractStatement (Block a) = a
extractStatement (DoWhileStatement _ _ a) = a
extractStatement (Continue a) = a
extractStatement (Break a) = a
extractStatement (Return _ a) = a
extractStatement (Throw a) = a
extractStatement (EmitStatement _ _ a) = a
extractStatement (AssemblyStatement _ a) = a
extractStatement (SimpleStatement _ a) = a
extractStatement (RevertStatement _ _ a) = a
extractStatement (UncheckedStatement _ a) = a

type Statement = Positioned StatementF

data Location = Memory | Storage deriving (Show, Eq, Generic)

instance ToJSON Location
instance FromJSON Location

data VarDefEntryF a = BlankEntry
                    | VarDefEntry { vardefType :: Maybe Type
                                  , _vardefLocation :: Maybe Location
                                  , vardefName :: Label
                                  , vardefContext :: a
                                  } deriving (Show, Eq, Generic, Functor)

type VarDefEntry = Positioned VarDefEntryF

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

data SimpleStatementF a =
  VariableDefinition [VarDefEntryF a] (Maybe (ExpressionF a)) -- Nothing type indicates "var" keyword
  | ExpressionStatement (ExpressionF a) deriving (Show, Eq, Generic, Functor)

type SimpleStatement = Positioned SimpleStatementF

instance ToJSON a => ToJSON (SimpleStatementF a)
instance FromJSON a => FromJSON (SimpleStatementF a)

-- Currently, the only supported inline assembly is:
-- assembly {
--  result := mload(add(source, 32))
-- }
-- Anything else is a parse error.
data InlineAssembly = MloadAdd32 T.Text T.Text deriving (Show, Eq, Generic)

instance ToJSON InlineAssembly
instance FromJSON InlineAssembly


data ExpressionF a =
  PlusPlus a (ExpressionF a)
  | MinusMinus a (ExpressionF a)
  | NewExpression a Type
  | IndexAccess a (ExpressionF a) (Maybe (ExpressionF a))
  | MemberAccess a (ExpressionF a) Label -- ie- "x.y"
  | FunctionCall a (ExpressionF a) (ArgListF a)
  | Unitary a String (ExpressionF a)
  | Binary a String (ExpressionF a) (ExpressionF a)
  | Ternary a (ExpressionF a) (ExpressionF a) (ExpressionF a)
  | BoolLiteral a Bool
  | NumberLiteral a Integer (Maybe NumberUnit)
  | StringLiteral a String
  | TupleExpression a [Maybe (ExpressionF a)]
  | ArrayExpression a [(ExpressionF a)]
  | Variable a Label 
  | ObjectLiteral a (Map.Map Label (ExpressionF a))
  deriving (Show, Eq, Generic, Functor)

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
extractExpression (StringLiteral a _) = a
extractExpression (TupleExpression a _) = a
extractExpression (ArrayExpression a _) = a
extractExpression (Variable a _) = a
extractExpression (ObjectLiteral a _) = a

type Expression = Positioned ExpressionF

instance ToJSON a => ToJSON (ExpressionF a)
instance FromJSON a => FromJSON (ExpressionF a)

data ArgListF a = OrderedArgs [ExpressionF a] | NamedArgs [(Label, (ExpressionF a))] deriving (Show, Eq, Generic, Functor)

type ArgList = Positioned ArgListF

instance ToJSON a => ToJSON (ArgListF a)
instance FromJSON a => FromJSON (ArgListF a)

data NumberUnit = Wei | Szabo | Finney | Ether deriving (Show, Eq, Generic)

instance ToJSON NumberUnit
instance FromJSON NumberUnit
