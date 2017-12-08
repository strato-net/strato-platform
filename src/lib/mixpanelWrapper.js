import mixpanel from 'mixpanel-browser';

import { env } from '../env';

const disabled = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test' || env.STRATO_GS_MODE === '1';

const mixpanelWrapper = {
  init: function(id) {
    if(disabled) {
      return;
    }
    mixpanel.init(id);
  },
  identify: function(name) {
    if(disabled) {
      return;
    }
    mixpanel.identify(name);
  },
  track: function(eventName) {
    if(disabled) {
      return;
    }
    mixpanel.track(eventName);
  }
};

export default mixpanelWrapper;
