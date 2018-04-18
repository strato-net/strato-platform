export const initialState = {
  isTempPasswordVerified: false,
  error: null
};

export const initialStateWithError = {
  isTempPasswordVerified: false,
  error: 'error occured'
};

export const initialStateWithVerifiedPassword = {
  isTempPasswordVerified: true,
  error: null
};

export const formData = {
  tempPassword: 'password',
  email: 'no-reply@blockapps.net'
}

export const mockResponse = { success: true, error: null };

export const error = 'error occured';