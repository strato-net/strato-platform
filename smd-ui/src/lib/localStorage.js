import { isModePublic } from './checkMode';

export function currentUser() {
  let token = localStorage.getItem('token');

  if (!isModePublic() && token) {
    localStorage.removeItem('token');
    return {};
  }

  if (token !== null) {
    return JSON.parse(token);
  }

  return {};
}

export function getUserFromLocal() {
  let user = localStorage.getItem('user');

  if (user !== null) {
    return JSON.parse(user);
  }

  return null;
}