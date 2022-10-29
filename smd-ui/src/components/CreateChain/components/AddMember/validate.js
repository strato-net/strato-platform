export function validate(values, userSelected) {
  const errors = {};

  if (userSelected && !values.username) {
    errors.username = 'required';
  }

  if (!values.orgName) {
    errors.orgName = 'required';
  }

  if (!values.orgUnit) {
    errors.orgUnit = 'required';
  }

  if (!values.commonName) {
    errors.commonName = 'required';
  }

  // if (!values.enode) {
  //   errors.enode = 'required';
  // }

  return errors;
}