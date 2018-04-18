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