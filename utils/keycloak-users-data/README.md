# Mercata users data script

## What is it
This script generates the CSV with data about Mercata users (Keycloak realm + vault data) and sends file over Slack

## Prerequisites
- Python 3 (3.7+)
- Credentials for in credentials.py

## Configure
- Populate credentials.py
- Install dependencies:
  - ```sudo pip3 install -r requirements.txt``` (note: use sudo here to install dependencies for root user if script will be executed from root crontab)

## Run
```
sudo python3 userdata.py >> userdata.log
```

## Run without Slack message
execute with `SLACK_DISABLED=true`:

```
sudo SLACK_DISABLED=true python3 userdata.py >> userdata.log
```

## Crontab record example
```
CRON_TZ=America/New_York
15 10 * * 1-5 (cd /home/ec2-user/strato-platform/utils/keycloak-users-data && python3 userdata.py >> userdata.log)
```
(run at 10:15am Eastern on Mon-Fri)

