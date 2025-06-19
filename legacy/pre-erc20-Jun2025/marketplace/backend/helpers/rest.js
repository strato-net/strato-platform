import chai from 'chai';
import chaiHttp from 'chai-http';
import config from 'load.config';
import server from 'index';
import constants from './constants';
import { readFileSync } from 'fs';
import { basename } from 'path';
chai.use(chaiHttp);

const getUrl = (prefix, endpoint) => `${constants.baseUrl}${prefix}${endpoint}`;

export const get = async (prefix, endpoint, query, accessToken = null) => {
  if (accessToken) {
    return chai
      .request(server)
      .get(getUrl(prefix, endpoint))
      .set(
        'Cookie',
        `${config.nodes[0].oauth.appTokenCookieName}=${accessToken}`
      )
      .query(query);
  }
  return chai.request(server).get(getUrl(prefix, endpoint)).query(query);
};

export const post = async (prefix, endpoint, body, accessToken = null) => {
  if (accessToken) {
    return chai
      .request(server)
      .post(getUrl(prefix, endpoint))
      .set(
        'Cookie',
        `${config.nodes[0].oauth.appTokenCookieName}=${accessToken}`
      )
      .send(body);
  }
  return chai.request(server).post(getUrl(prefix, endpoint)).send(body);
};

export const patch = async (prefix, endpoint, body, accessToken = null) => {
  if (accessToken) {
    return chai
      .request(server)
      .patch(getUrl(prefix, endpoint))
      .set(
        'Cookie',
        `${config.nodes[0].oauth.appTokenCookieName}=${accessToken}`
      )
      .send(body);
  }
  return chai.request(server).patch(getUrl(prefix, endpoint)).send(body);
};

export const put = async (prefix, endpoint, body, accessToken = null) => {
  if (accessToken) {
    return chai
      .request(server)
      .put(getUrl(prefix, endpoint))
      .set(
        'Cookie',
        `${config.nodes[0].oauth.appTokenCookieName}=${accessToken}`
      )
      .send(body);
  }
  return chai.request(server).put(getUrl(prefix, endpoint)).send(body);
};

export const postFile = async (
  prefix,
  endpoint,
  filePath,
  accessToken = null
) => {
  if (accessToken) {
    return chai
      .request(server)
      .post(getUrl(prefix, endpoint))
      .set(
        'Cookie',
        `${config.nodes[0].oauth.appTokenCookieName}=${accessToken}`
      )
      .attach(
        constants.fileUploadFieldName,
        readFileSync(filePath),
        basename(filePath)
      );
  }
  return chai
    .request(server)
    .post(getUrl(prefix, endpoint))
    .field('description', description)
    .attach(
      constants.fileUploadFieldName,
      readFileSync(filePath),
      basename(filePath)
    );
};
