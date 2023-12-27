{-# LANGUAGE OverloadedStrings #-}

module SortDirection where

import Control.Lens.Operators
import Data.Swagger
import qualified Data.Text as T
import qualified Database.Esqueleto.Legacy as E
import Database.Persist.Postgresql
import Servant

data Sortby = ASC | DESC deriving (Eq, Ord, Show)

instance ToHttpApiData Sortby where
  toUrlPiece ASC = "asc"
  toUrlPiece DESC = "desc"

instance FromHttpApiData Sortby where
  parseQueryParam x =
    case x of
      "asc" -> Right ASC
      "desc" -> Right DESC
      _ -> Left $ T.pack $ "Could not parse sortby parameter: " ++ show x

instance ToParamSchema Sortby where
  toParamSchema _ = mempty & type_ ?~ SwaggerString

sortToOrderBy ::
  PersistField a =>
  Maybe Sortby ->
  E.SqlExpr (E.Value a) ->
  E.SqlExpr E.OrderBy
sortToOrderBy (Just ASC) x = E.asc x
sortToOrderBy (Just DESC) x = E.desc x
sortToOrderBy _ x = E.asc x
