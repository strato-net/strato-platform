tail -f logs/vm-runner | grep Inserting
curl http://127.0.0.1:10248/threads | jq . | sort -n -k2
curl http://127.0.0.1:10248/peers | jq .
queryStrato syncstats
echo "select * from sync_task order by chiliad;" | psql -Upostgres -hpostgres eth
