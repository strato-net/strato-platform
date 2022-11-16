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
  ( optionalTableField "id"
  , requiredTableField "schema_version"
  )

usersTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGText
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGText
  )
  ( Column PGInt4
  , Column PGText
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGText
  )
usersTable = Table "users" $ p7
  ( optionalTableField "id"
  , requiredTableField "x_user_unique_name"
  , requiredTableField "salt"
  , requiredTableField "nonce"
  , requiredTableField "enc_sec_prv_key"
  , requiredTableField "address"
  , requiredTableField "oauth_provider_id"
  )

messageTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  )
  ( Column PGInt4
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  )
messageTable = Table "message" $ p4
  ( optionalTableField "id"
  , requiredTableField "salt"
  , requiredTableField "nonce"
  , requiredTableField "enc_msg"
  )
