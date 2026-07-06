module Strato.Strato23.Database.Tables where

import Data.Profunctor.Product
import Opaleye
import Opaleye.Internal.PGTypesExternal
import Opaleye.Internal.Table

schemaVersionTable ::
  Table
    ( Maybe (Field PGInt4),
      Field PGInt4
    )
    ( Field PGInt4,
      Field PGInt4
    )
schemaVersionTable =
  Table "vault_wrapper_schema_version" $
    p2
      ( optionalTableField "id",
        requiredTableField "schema_version"
      )

usersTable ::
  Table
    ( Maybe (Field PGInt4),
      Field PGText,
      Field PGText,
      Field PGBytea,
      Field PGBytea,
      Field PGBytea,
      Field PGBytea
    )
    ( Field PGInt4,
      Field PGText,
      Field PGText,
      Field PGBytea,
      Field PGBytea,
      Field PGBytea,
      Field PGBytea
    )
usersTable =
  Table "users" $
    p7
      ( optionalTableField "id",
        requiredTableField "x_user_unique_name",
        requiredTableField "x_identity_provider_id",
        requiredTableField "salt",
        requiredTableField "nonce",
        requiredTableField "enc_sec_prv_key",
        requiredTableField "address"
      )

-- MPC key shards: the Vault-held shard of a 2-of-2 split key, encrypted at rest
-- with the same SecretBox master key as the `users` table. Kept entirely separate
-- from `users` so the existing key/signature flows are untouched.
mpcKeysTable ::
  Table
    ( Maybe (Field PGInt4),
      Field PGText,
      Field PGText,
      Field PGBytea,
      Field PGBytea,
      Field PGBytea,
      Field PGBytea
    )
    ( Field PGInt4,
      Field PGText,
      Field PGText,
      Field PGBytea,
      Field PGBytea,
      Field PGBytea,
      Field PGBytea
    )
mpcKeysTable =
  Table "mpc_keys" $
    p7
      ( optionalTableField "id",
        requiredTableField "x_user_unique_name",
        requiredTableField "x_identity_provider_id",
        requiredTableField "salt",
        requiredTableField "nonce",
        requiredTableField "enc_shard",
        requiredTableField "address"
      )

messageTable ::
  Table
    ( Maybe (Field PGInt4),
      Field PGBytea,
      Field PGBytea,
      Field PGBytea
    )
    ( Field PGInt4,
      Field PGBytea,
      Field PGBytea,
      Field PGBytea
    )
messageTable =
  Table "message" $
    p4
      ( optionalTableField "id",
        requiredTableField "salt",
        requiredTableField "nonce",
        requiredTableField "enc_msg"
      )
