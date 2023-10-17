KEYCLOAK = {
    'realm_name': 'mercata',
    'client': {
        # client with client-credentials grant enabled in the target realm (e.g. 'mercata' realm)
        'client_id': '__CLIENT_ID_HERE__',
        'client_secret': '__CLIENT_SECRET_HERE__',
    },
    'master_realm_client': {
        # client with client-credentials grant enabled in the master realm, and with the view access to target realm users 
        'client_id': '__CLIENT_ID_HERE__',
        'client_secret': '__CLIENT_SECRET_HERE__'
    },
}
VAULT = {
    'vault_url': '__VAULT_URL_HERE__' # e.g. https://vault.blockapps.net:8093
}
SLACK = {
    'slack_token': '__SLACK_TOKEN_HERE__', # e.g. a token of "Mercata Metrics" Slack app
    'stats_channel_id': 'C043YAYTA5U',
    'ops_channel_id': 'GR5UDCPPE',
}
HOST_DESCRIPTION = 'localhost' # e.g. "Mercata Monitor", or "Mercata node1" or "monitor.mercata.blockapp.net"
