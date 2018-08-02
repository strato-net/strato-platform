export default function validate(values) {
  const errors = {};

  if (!values.username) {
    errors.username = 'Select username';
  }

  if (!values.address) {
    errors.address = 'Address required';
  }

  if (!values.password) {
    errors.password = 'Password required';
  }
  
  if (!values.contractAddress) {
    errors.contractAddress = "Can't be blank";
  }

  return errors;
}