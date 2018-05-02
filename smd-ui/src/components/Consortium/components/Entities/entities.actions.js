export const OPEN_INVITE_ENTITY_MODAL = 'OPEN_INVITE_ENTITY_MODAL';
export const CLOSE_INVITE_ENTITY_MODAL = 'CLOSE_INVITE_ENTITY_MODAL';

export function openInviteEntityModal() {
  return {
    type: OPEN_INVITE_ENTITY_MODAL
  }
}

export function closeInviteEntityModal() {
  return {
    type: CLOSE_INVITE_ENTITY_MODAL
  }
}