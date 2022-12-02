ServiceProvider=$1
IndexOfLastIndexOfNewVaultDb=$2


# STEP 1: Get data from old vault  --> We only need message table and user table
#docker exec strato_strato_1 bash -c 'apt-get update -y' 
docker exec strato_strato_1 bash -c $'PGPASSWORD=api psql -U postgres -h postgres oauth -c "\COPY users TO \'userTable.csv\' DELIMITER \',\' CSV HEADER;"'
docker cp strato_strato_1:var/lib/strato/userTable.csv ./

docker exec strato_strato_1 bash -c $'PGPASSWORD=api psql -U postgres -h postgres oauth -c "\COPY message TO \'messageTable.csv\' DELIMITER \',\' CSV HEADER;"'
docker cp strato_strato_1:var/lib/strato/messageTable.csv ./


#STEP 2: remove header from csv file and give proper index to columns, remove columns from old schema, add new oauth provicder id column 
#     Note this python script cleans both Message table and User table
#     I don't think message table is really needed
#     Note this produces an entirely new table
python3 cleanDevelopVault.py $ServiceProvider  $IndexOfLastIndexOfVaultDb



