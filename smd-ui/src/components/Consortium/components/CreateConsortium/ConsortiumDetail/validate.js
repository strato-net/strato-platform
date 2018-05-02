export function validate(values) {

  const errors = {};
  
  if (!values.networkId) {
    errors.networkId = 'Please enter the network ID';
  } 
  if (!values.addEntityRules) {
    errors.addEntityRules = 'Please choose a rule for adding entities rule';
  }
  if (!values.removeEntityRules) {
    errors.removeEntityRules = 'Please choose a rule for removing entities';
  }

  return errors;
}