export function validate(values) {
  const errors = {};

  if (!values.entityName) {
    errors.entityName = "Please Enter entity name";
  }

  if (!values.nodeUrl) {
    errors.nodeUrl = "Please enter node URL";
  }

  if (!values.adminEtheriumAddress) {
    errors.adminEtheriumAddress = "Please enter etherium address";
  }

  if (!values.adminName) {
    errors.adminName = "please enter admin name";
  }

  if (!values.adminEmail) {
    errors.adminEmail = "please enter admin email";
  }

  if (!values.tokenAmount) {
    errors.tokenAmount = "please enter token amount";
  }

  return errors;
}