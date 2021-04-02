import mixpanel from 'mixpanel-browser';

//TODO: take away the mixpanel code entirely
const disabled = true //process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

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
