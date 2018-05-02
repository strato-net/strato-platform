export function validate(values) {

  const errors = {};
  
  if (!values.name) {
    errors.name = 'Please enter the entity name';
  } 
  if (!values.eNodeUrl) {
    errors.eNodeUrl = 'Please enter the e-node URL';
  }
  if (!values.adminEthereumAddress) {
    errors.adminEthereumAddress = 'Please enter the admin ethereum address';
  }
  if (!values.adminName) {
    errors.adminName = 'Please enter the admin name';
  }
  if (!values.adminEmail) {
    errors.adminEmail = 'Please enter the admin email';
  } else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}$/i.test(values.adminEmail)) {
    errors.adminEmail = 'Please enter a valid admin email';
  }
  if (!values.tokenAmount) {
    errors.tokenAmount = 'Please enter the token amount to be sent';
  }

  return errors;
}