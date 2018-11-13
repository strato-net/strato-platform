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
  , required "schema_version"
  )

usersTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGText
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  )
  ( Column PGInt4
  , Column PGText
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  )
usersTable = Table "users" $ p6
  ( optional "id"
  , required "x_user_unique_name"
  , required "salt"
  , required "nonce"
  , required "enc_sec_key"
  , required "address"
  )
