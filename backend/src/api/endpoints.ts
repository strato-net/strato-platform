export const Authentication = {
    prefix: '/authentication',
    callback: '/callback',
    logout: '/logout',
} as const;

export type AuthenticationEndpoints = typeof Authentication;

export const Users = {
    prefix: '/users',
    me: '/me',
} as const;

export type UsersEndpoints = typeof Users;

export const Assets = {
    prefix: '/assets',
    get: '/:address',
    getAll: '/',
    create: '/',
    transfer: '/transfer',
} as const;

export type AssetsEndpoints = typeof Assets;