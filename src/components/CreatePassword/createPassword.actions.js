export const OPEN_CREATE_PASSWORD_MODAL = 'OPEN_CREATE_PASSWORD_MODAL';
export const CLOSE_CREATE_PASSWORD_MODAL = 'CLOSE_CREATE_PASSWORD_MODAL';

export const openCreatePasswordModal = function () {
  return {
    type: OPEN_CREATE_PASSWORD_MODAL
  }
}

export const closeCreatePasswordModal = function () {
  return {
    type: CLOSE_CREATE_PASSWORD_MODAL
  }
}

