newPass=$1
oldPass=$2
curPostgresIndex=$3


docker cp userTableModfied.csv vault_vault-wrapper_1:userTableModfied.csv
echo "Moved user table into vault docker"

docker cp messageTableModfied.csv vault_vault-wrapper_1:messageTableModfied.csv
echo "moved message table into vault docker"

docker exec vault_vault-wrapper_1 bash -c $'PGPASSWORD=api psql -U postgres -h postgres oauth -c "\COPY users FROM \'userTableModfied.csv\' WITH  (FORMAT csv);"'
echo "imported user table into postgres, existing user table"

docker exec vault_vault-wrapper_1 bash -c $'PGPASSWORD=api psql -U postgres -h postgres oauth -c "\COPY message FROM \'messageTableModfied.csv\' WITH  (FORMAT csv);"'
echo "imported message table into postgres, existing table"

docker exec vault_vault-wrapper_1 bash -c "migrate-mercata --pw=$newPass  --pwOld=$oldPass --indexToStartAt=$curPostgresIndex"

docker exec vault_vault-wrapper_1 bash -c $'PGPASSWORD=api psql -U postgres -h postgres oauth -c "DELETE from message where id<>1;"'