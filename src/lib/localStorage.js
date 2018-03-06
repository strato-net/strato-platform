export function currentUser() {
  let token = localStorage.getItem('token');

  if (token !== null) {
    return JSON.parse(token);
  }

  return {};
}