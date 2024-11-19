import cronFunc from '../cron';
import config from '../load.config';
import oauthHelper from './oauthHelper';
import axios from 'axios';

export const cronSyncCall = async () => {
  try {
    const token = await oauthHelper.getServiceToken();
    const url = config.serverHost;
    const syncResponse = await axios.get(
      `${url}/strato-api/eth/v1.2/metadata`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!syncResponse.data.isSynced) {
      setTimeout(cronSyncCall, 5 * 60 * 1000);
    } else {
      cronFunc();
    }
  } catch (error) {
    console.error('Error while checking sync status:', error);
  }
};
