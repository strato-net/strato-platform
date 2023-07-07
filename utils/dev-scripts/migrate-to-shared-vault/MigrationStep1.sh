ServiceProvider=$1
OAUTH_CLIENT_ID=$2
OAUTH_CLIENT_SECRET=$3
IndexOfLastIndexOfNewVaultDb=$4


# STEP 1: Get data from old vault  --> We only need message table and user table
docker exec strato-strato-1 bash -c $'PGPASSWORD=api psql -U postgres -h postgres oauth -c "\COPY users TO \'userTable.csv\' DELIMITER \',\' CSV HEADER;"'
docker cp strato-strato-1:var/lib/strato/userTable.csv ./

docker exec strato-strato-1 bash -c $'PGPASSWORD=api psql -U postgres -h postgres oauth -c "\COPY message TO \'messageTable.csv\' DELIMITER \',\' CSV HEADER;"'
docker cp strato-strato-1:var/lib/strato/messageTable.csv ./


#STEP 2: remove header from csv file and give proper index to columns, remove columns from old schema, add new oauth provicder id column 
#     Note this python script cleans both Message table and User table
#     Note this produces an entirely new table just in case there is a issue in the migration process
python3 cleanDevelopVault.py $ServiceProvider $OAUTH_CLIENT_ID $OAUTH_CLIENT_SECRET $IndexOfLastIndexOfNewVaultDb



