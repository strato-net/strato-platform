export const APP_USERNAME_CHANGE = 'APP_USERNAME_CHANGE';
export const LAUNCHPAD_LOAD = 'LAUNCHPAD_LOAD'

export const loadLaunchPad =   function() {
  return {
    type: LAUNCHPAD_LOAD
  }
}

export const usernameChange = function(name) {
  return {
    type: APP_USERNAME_CHANGE,
    name:  name
  }
}
