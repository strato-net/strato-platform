module Strato.Strato23.Database.Tables where

import           Data.Profunctor.Product
import           Opaleye

schemaVersionTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGInt4
  )
  ( Column PGInt4
  , Column PGInt4
  )
schemaVersionTable = Table "vault_wrapper_schema_version" $ p2
  ( optional "id"
  , required "vault_wrapper_version"
  )

usersTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGText
  , Column PGBytea
  )
  ( Column PGInt4
  , Column PGText
  , Column PGBytea
  )
usersTable = Table "users" $ p3
  ( optional "id"
  , required "x_user_unique_name"
  , required "enc_sec_key"
  )
