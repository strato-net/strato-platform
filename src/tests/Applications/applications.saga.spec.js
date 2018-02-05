import watchFetchApplications, {
  fetchApplications,
  launchApps,
  launchApp,
  getApplications,
  sleep
} from '../../components/Applications/applications.saga';
import {
  takeEvery,
  call,
  put
} from 'redux-saga/effects';
import {
  FETCH_APPLICATIONS,
  fetchApplicationsSuccess,
  fetchApplicationsFailure,
  LAUNCH_APP,
  launchAppSuccess,
  launchAppFailure
} from '../../components/Applications/applications.actions';
import { expectSaga } from 'redux-saga-test-plan';
import { applicationData, errorFetchApp, errorLaunchApp } from './applicationsMock';

describe('Applications: saga', () => {

  test('watch applications', () => {
    const gen = watchFetchApplications();
    expect(gen.next().value).toEqual(takeEvery(FETCH_APPLICATIONS, fetchApplications))
    expect(gen.next().value).toEqual(takeEvery(LAUNCH_APP, launchApps))
  })

  describe('fetchapplications generator', () => {

    test('inspection', () => {
      const gen = fetchApplications({ type: "FETCH_APPLICATIONS" });
      expect(gen.next().value).toEqual(call(getApplications));
      expect(gen.next().value).toEqual(put(fetchApplicationsSuccess()));
      expect(gen.next().done).toBe(true);
    })

    describe('fetch applications', () => {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(applicationData));
        expectSaga(fetchApplications)
          .call.fn(getApplications).put.like({ action: { type: 'FETCH_APPLICATIONS_SUCCESSFUL' } })
          .run().then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject(JSON.stringify(errorFetchApp));

        expectSaga(fetchApplications)
          .call.fn(getApplications).put.like({ action: { type: 'FETCH_APPLICATIONS_FAILURE' } })
          .run().then((result) => { done() });
      });

      test('exception', () => {
        expectSaga(fetchApplications)
          .provide({
            call() {
              throw new Error('Not Found');
            },
          })
          .put.like({ action: { type: 'FETCH_APPLICATIONS_FAILURE' } })
          .run();
      });

    })

  });

  describe('launch apps generator', () => {
    
    describe('inspection', ()=> {

      test('success', () => {
        const gen = launchApps({ type: "LAUNCH_APP", url:'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/' });
        expect(gen.next().value).toEqual(call(launchApp, 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/'));
        expect(gen.next({status:300}).value).toEqual(call(sleep,1000)); 
        expect(gen.next({status:200}).value).toEqual(call(launchApp, 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/'));      
        expect(gen.next({status:200}).value).toEqual(put(launchAppSuccess()));
        expect(gen.next().done).toBe(true);
      })

      test('failed', () => {
        const gen = launchApps({ type: "LAUNCH_APP", url:'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/' });
        expect(gen.next().value).toEqual(call(launchApp, 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/'));
        expect(gen.next({status:300}).value).toEqual(call(sleep,1000)); 
        expect(gen.next().value).toEqual(call(launchApp, 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/'));      
        expect(gen.next({status:300}).value).toEqual(call(sleep,1166.6666666666667)); 
        expect(gen.next().value).toEqual(call(launchApp, 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/'));              
        expect(gen.next({status:300}).value).toEqual(call(sleep,1400)); 
        expect(gen.next().value).toEqual(call(launchApp, 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/'));              
        expect(gen.next({status:300}).value).toEqual(call(sleep,1750)); 
        expect(gen.next().value).toEqual(call(launchApp, 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/'));              
        expect(gen.next({status:300}).value).toEqual(call(sleep,2333.3333333333335)); 
        expect(gen.next().value).toEqual(call(launchApp, 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/'));              
        expect(gen.next({status:300}).value).toEqual(call(sleep,3500)); 
        expect(gen.next().value).toEqual(call(launchApp, 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/'));              
        expect(gen.next({status:300}).value).toEqual(call(sleep,7000)); 
        expect(gen.next().value).toEqual(call(launchApp, 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/'));              
        expect(gen.next({status:300}).value).toEqual(put(launchAppFailure(Error('Timeout on app fetching'))));        
        expect(gen.next().done).toBe(true);
      })

    })

    test('success 200', (done) => {
      fetch.mockResponse(JSON.stringify({ status: 200 }));
      expectSaga(launchApps, { type: "LAUNCH_APP", url: 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/' })
        .call.fn(launchApp).put.like({ action: { type: 'LAUNCH_APP_SUCCESSFUL' } })
        .run().then((result) => { done() });
    });

    test('success 301', (done) => {
      fetch.mockResponse(JSON.stringify({}), { status: 301 });
      expectSaga(launchApps, { type: "LAUNCH_APP", url: 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/' })
        .call.fn(launchApp)
        .run().then((result) => {
          done()
        });
    });

    test('launch apps with status code other than 200', (done) => {
      fetch.mockReject(JSON.stringify({ error: errorLaunchApp, status: 400 }));
      expectSaga(launchApps, { type: "LAUNCH_APP", url: 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/' })
        .call.fn(launchApp).put.like({ action: { type: 'LAUNCH_APP_FAILURE' } })
        .run().then((result) => { done() });
    });

    test('exception', () => {
      expectSaga(launchApps, { type: "LAUNCH_APP", url: 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/' })
        .provide({
          call() {
            throw new Error('Not Found');
          },
        })
        .put.like({ action: { type: 'LAUNCH_APP_FAILURE' } })
        .run();
    });

  })

})

