
module Blockchain.AST1 where

import qualified Prelude
import Prelude hiding (Integer, String)

import Data.List

import Text.Format
import Blockchain.Type (Type)

data VariableDefinition =
  VariableDefinition Prelude.String Type

data Expression =
  Integer Prelude.Integer
  | String Prelude.String
  | Function Prelude.String [Expression]
  | Variable Prelude.String deriving (Show)

instance Format Expression where
  format (Integer i) = show i
  format (String s) = show s
  format (Function name args) = name ++ "(" ++ intercalate ", " (map format args) ++ ")"
  format (Variable name) = name

data Statement =
  Assign Expression Expression
  | ExpressionStatement Expression deriving (Show)

instance Format Statement where
  format (Assign e1 e2) = format e1 ++ " = " ++ format e2
  format (ExpressionStatement e) = format e
