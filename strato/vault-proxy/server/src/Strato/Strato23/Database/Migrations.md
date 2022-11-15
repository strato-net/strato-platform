# Vault Wrapper DB Migrations
Everytime a change to the Vault Wrapper DB schema is needed, an appropriate migration must be added to the migrations list in Migration.hs. This is due to our public test-net nodes and client nodes that persist Postgres volumes between software releases.
## Adding a migration
* Create each step of your migration as a separate `Query` function.
* Append the `migrations` list with each step of your migration, in order.
* Supply a `MigrationErrorBehavior` label to each step of your migration.
 * `Catch` if an error in the migration step **is not** fatal, and program execution may continue.
 * `Throw` if an error in the migration step **is** fatal, and the program should abort.
