import mixpanel from 'mixpanel-browser';



const mixpanelWrapper = {
  init: function(id) {
    if(process.env.NODE_ENV === 'development') {
      return;
    }
    mixpanel.init(id);
  },
  identify: function(name) {
    if(process.env.NODE_ENV === 'development') {
      return;
    }
    mixpanel.identify(name);
  },
  track: function(eventName) {
    if(process.env.NODE_ENV === 'development') {
      return;
    }
    mixpanel.track(eventName);
  }
}

export default mixpanelWrapper;
