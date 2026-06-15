export function getUserFromLocal() {
  let user = localStorage.getItem('user');

  if (user !== null) {
    return JSON.parse(user);
  }

  return null;
}