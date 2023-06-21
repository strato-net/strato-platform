#!/usr/bin/env bash
start=$(date +'%s')

function check_timeout() {
  now=$(date +'%s')
  if [[ $(( $start + 300 )) -le $now ]]; then
    echo "Test timed out! Waited 5 minutes for slipstream to populate table"
    exit 2
  fi
}

function query() {
  docker exec strato-postgres-1 \
    psql -d cirrus -U postgres -h localhost -t -A '--field-separator=#' -c "${1}"
}

function compare_strings() {
  MSG=$1
  WANT=$2
  GOT=$3
  if [[ "${GOT}" != "${WANT}" ]]; then
    echo "Test failed! ${MSG}"
    echo "Wanted:"
    echo "${WANT}"
    for x in $WANT; do
      echo $x
    done
    echo "But got:"
    echo "${GOT}"
    for y in $GOT; do
      echo $y
    done
    exit 1
  fi
}

echo "Testing genesis ingestion"
echo "Waiting until slipstream has populated postgres..."
while sleep 1; do
  check_timeout
  COUNT=$(query "select count(*) from \"StringStorage\"");
  if [[ ${COUNT} -eq "2" ]]; then
    echo "2 StringStorage found";
    break
  fi
done

WANT_STRING="text, text, hot off the press!
one, measly, quote: ' "
GOT_STRING=$(query "select payload from \"StringStorage\"");

compare_strings 'Single column records do not match' ${WANT_STRING} ${GOT_STRING}

while sleep 1; do
  check_timeout
  COUNT=$(query "select count(*) from \"MultiStorage\"");
  if [[ ${COUNT} -eq "3" ]]; then
    echo "3 Multistorages found";
    break;
  fi
done

# TODO(tim): Test 'z' as well once the format makes sense
# It looks like a string of json strings of numbers at present.
WANT_MULTI="77#Hello
1234#Goodbye
88888888#Why are you still here?"
GOT_MULTI=$(query "select x,y from \"MultiStorage\" order by x");

compare_strings 'Multi column records do not match' "${WANT_MULTI}" "${GOT_MULTI}"

while sleep 1; do
  check_timeout
  COUNT=$(query "select count(*) from \"LargeAddressStorage\"");
  if [[ ${COUNT} -eq "1" ]]; then
    echo "1 LargeAddressStorage found";
    break
  fi
done

WANT_LSTRING=""
GOT_LSTRING=$(query "select y from \"LargeAddressStorage\"");

compare_strings 'Large column records do not match' ${WANT_LSTRING} ${GOT_LSTRING}
echo "Test passed"
