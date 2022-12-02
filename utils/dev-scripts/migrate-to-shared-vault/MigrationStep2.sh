newPass=$1
oldPass=$2
curPostgresIndex=$3


(docker exec -it strato_strato_1 bash -c $'PGPASSWORD=api psql -U postgres -h postgres oauth -c "SELECT id FROM users WHERE id=(select max(id) from users);"')


docker cp userTableModfied.csv strato_strato_1:var/lib/strato/userTableModfied.csv
echo "Moved user table into vault docker"


docker cp messageTableModfied.csv strato_strato_1:var/lib/strato/messageTableModfied.csv
echo "moved message table into vault docker"

docker exec strato_strato_1 bash -c $'PGPASSWORD=api psql -U postgres -h postgres oauth -c "\COPY users FROM \'userTableModfied.csv\' WITH  (FORMAT csv);"'
echo "imported user table into postgres, existing user table"

docker exec strato_strato_1 bash -c $'PGPASSWORD=api psql -U postgres -h postgres oauth -c "\COPY message FROM \'messageTableModfied.csv\' WITH  (FORMAT csv);"'
echo "imported message table into postgres, existing table"

docker exec strato_strato_1 bash -c "migrate-mercata --pw=$newPass  --pwOld=$oldPass --indexToStartAt=$curPostgresIndex"
