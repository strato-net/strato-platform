import 'cypress-file-upload';
import { productData, inventoryData } from '../fixtures/data.js';
import dayjs from 'dayjs';

// ***********************************************
// This example commands.js shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************
//
//
// -- This is a parent command --
// Cypress.Commands.add('login', (email, password) => { ... })
//
//
// -- This is a child command --
// Cypress.Commands.add('drag', { prevSubject: 'element'}, (subject, options) => { ... })
//
//
// -- This is a dual command --
// Cypress.Commands.add('dismiss', { prevSubject: 'optional'}, (subject, options) => { ... })
//
//
// -- This will overwrite an existing command --
// Cypress.Commands.overwrite('visit', (originalFn, url, options) => { ... })
Cypress.on(
  'uncaught:exception',
  // (err) => !err.message.includes('ResizeObserver loop limit exceeded')
  (err) => false
);

// Cypress.on('uncaught:exception', (err) => {
//   /* returning false here prevents Cypress from failing the test */
//   if (err.message.includes("ResizeObserver loop limit exceeded")) {
//     return false
//   }
// })

Cypress.Commands.add('login', (username, password) => {
  let un = username ? username : Cypress.env('email');
  let pwd = password ? password : Cypress.env('password');

  cy.get('input[name=username]').type(un);
  cy.get('input[name=password]').type(pwd);
  cy.get('form').submit();
});

Cypress.Commands.add('loginAsSeller', () => {
  cy.origin(Cypress.env('login_url'), () => {
    cy.get('input[name=username]').type(Cypress.env('sellerEmail'));
    cy.get('input[name=password]').type(Cypress.env('sellerPassword'));
    cy.get('form').submit();
  });
});

Cypress.Commands.add('loginAsCertifier', () => {
  cy.clearCookies();
  cy.visit('/');
  cy.origin(Cypress.env('login_url'), () => {
    cy.get('input[name=username]').type(Cypress.env('certifierEmail'));
    cy.get('input[name=password]').type(Cypress.env('certifierPassword'));
    cy.get('form').submit();
  });
});

Cypress.Commands.add('createProduct', (productName) => {
  cy.get('#Products').should('exist');
  cy.get('#Products').click();
  cy.url().should('include', '/products');
  cy.get('#add-product-button').should('exist');
  cy.get('#add-product-button').click();
  cy.get('#modal-title').contains('Add Product');
  cy.get('input[placeholder="Enter Name"]').type(productName);
  cy.get('#category').type('Art{enter}');
  cy.get('#subCategory').type('Art{enter}');
  cy.get('input[placeholder="Enter Manufacturer"]').type('Manufacturer A');
  cy.get('#unitofmeasurement').click().type('{enter}', { force: true });
  cy.get('input[placeholder="Enter Least Sellable Unit"]').type('100');
  cy.get('textarea[placeholder="Enter Description"]').type(
    'This is a description'
  );
  cy.get('input[type=file]').attachFile('cottonSeeds.jpg');
  cy.get('input[placeholder="Enter Unique Product Code"]').type('x_103');
  cy.get('#create-product-button').should('exist');
  cy.get('#create-product-button').click();
  cy.contains('Product created successfully').should('be.visible');
});

Cypress.Commands.add('createInventory', (productName) => {
  cy.get('#Inventory').should('exist');
  cy.get('#Inventory').click();
  cy.url().should('include', '/inventories');
  cy.get('#Inventory').should('exist');
  cy.get('#Inventory').click();
  cy.url().should('include', '/inventories');
  cy.get('button').contains('Add Inventory').should('exist');
  cy.get('button').contains('Add Inventory').click();
  cy.get('.ant-modal-content').should('exist').and('be.visible');
  cy.contains('Add Inventory').should('be.visible');
  cy.get('#category').type('Art{enter}');
  cy.get('#subCategory').type('Art{enter}');
  cy.get('input[placeholder="Enter Quantity"]').type('1');
  cy.get('input[placeholder="Enter Price"]').type('1000');
  cy.get('input[placeholder="Enter Batch ID"]').type('ABC123');
  cy.get('.ant-upload').contains('Upload CSV').should('exist');
  cy.get('input[type="file"]').selectFile('cypress/fixtures/base_seed.csv', {
    force: true,
  });
  cy.get('#product').should('be.enabled');

  cy.get('#product').click();
  cy.wait('@productNameCall')
    .its('response.body')
    .then((body) => {
      console.log(body);
      cy.wait(500);
      cy.get('.ant-select-dropdown :not(.ant-select-dropdown-hidden)')
        .find('.ant-select-item-option')
        .each((el) => {
          if (el.text() === productName) {
            cy.wait(500);
            cy.wrap(el).click();
            cy.wait(500);
          }
        });
    });
  cy.get('button').contains('Create Inventory').should('be.visible');
  cy.get('button').contains('Create Inventory').click();
  cy.contains('Inventory created successfully').should('be.visible');
});

Cypress.Commands.add('checkCategory', () => {
  cy.request({
    method: 'GET',
    url: '/api/v1/category',
  }).then(({ status, body }) => {
    expect(status).to.eq(200);
  });
});

Cypress.Commands.add('certifyEvents', () => {
  cy.request({
    method: 'GET',
    url: '/api/v1/event?filterByCertifier=true',
  }).then(({ status, body }) => {
    expect(status).to.eq(200);
    if (body.data.length > 0) {
      cy.get('button').contains('Certify Event').click();
      cy.contains(
        'Atleast one event should be selected to update comment'
      ).should('be.visible');
      cy.get("input[type='checkbox']").eq(1).should('exist');
      if (!cy.get('td').eq(22).contains('sample summary')) {
        cy.get("input[type='checkbox']")
          .eq(1)
          .should('not.be.disabled')
          .check();
        cy.get('button').contains('Certify Event').click();
        cy.get('.ant-modal-content').should('exist').and('be.visible');
        cy.get('.ant-modal-title')
          .contains('Certify Event')
          .should('be.visible');
        cy.get('button').eq(6).should('be.visible');
        cy.get('textarea').eq(0).type('sample summary');
        cy.get('button').eq(6).click();
        cy.wait(12000);
        cy.contains('Certifier comment has been updated').should('be.visible');
        cy.get("input[type='checkbox']").eq(1).should('be.disabled');
        cy.get('td').eq(22).contains('sample summary').should('be.visible');
      }

      cy.contains('View').eq(0).should('exist');
      cy.contains('View').eq(0).click();
      cy.wait(2000);
      cy.get('nav').contains('Home').should('exist');
      cy.get('nav').contains('Events').should('exist');
      cy.get('nav').contains(body.data[0].eventTypename).should('exist');
      cy.get('nav').contains('Serial Number').should('exist');
    } else {
      cy.request({
        method: 'GET',
        url: '/api/v1/category',
      }).then(({ status, body }) => {
        expect(status).to.eq(200);
        const category = body.data[0];
        cy.request({
          method: 'GET',
          url: '/api/v1/subcategory',
        }).then(({ status, body }) => {
          expect(status).to.eq(200);
          const subCategory = body.data[0];
          cy.request({
            method: 'POST',
            url: '/api/v1/product',
            body: {
              productArgs: {
                name: productData.name,
                description: productData.description,
                manufacturer: productData.manufacturer,
                unitOfMeasurement: productData.unitOfMeasurement,
                leastSellableUnit: productData.leastSellableUnit,
                imageKey: productData.imageKey,
                isActive: productData.isActive,
                category: category.address,
                subCategory: subCategory.address,
                userUniqueProductCode: productData.userUniqueProductCode,
              },
            },
          }).then(({ status, body }) => {
            expect(status).to.eq(200);
            const productId = body.data[1];
            const itemSerial = 'R100';
            cy.request({
              method: 'POST',
              url: '/api/v1/inventory',
              body: {
                productAddress: productId,
                quantity: inventoryData.quantity,
                pricePerUnit: inventoryData.pricePerUnit,
                batchId: inventoryData.batchId,
                status: inventoryData.status,
                serialNumber: [
                  {
                    itemSerialNumber: itemSerial,
                    rawMaterials: inventoryData.rawMaterials,
                  },
                ],
              },
            }).then(({ status, body }) => {
              expect(status).to.eq(200);
              cy.request({
                method: 'GET',
                url: '/api/v1/eventType',
              }).then(({ status, body }) => {
                expect(status).to.eq(200);
                const eventTypeId = body.data[0].address;
                cy.request({
                  method: 'GET',
                  url: '/api/v1/membership/certifiers/all',
                }).then(({ status, body }) => {
                  expect(status).to.eq(200);
                  let certifier;
                  if (body.data.length > 0)
                    certifier = body.data[0].userAddress;
                  cy.request({
                    method: 'POST',
                    url: '/api/v1/event',
                    body: {
                      eventTypeId: eventTypeId,
                      productId: productId,
                      date: 1681133652,
                      certifier:
                        certifier ?? '642568b654ba679a9667e48615da02db4c21c6a5',
                      summary: 'sample summary',
                      serialNumbers: [itemSerial],
                    },
                  }).then(({ status, body }) => {
                    cy.get('.ant-tabs-tab').eq(0).click();
                    cy.get('.ant-tabs-tab').eq(2).click();
                    cy.wait(20000);

                    cy.get('button').contains('Certify Event').click();
                    cy.contains(
                      'Atleast one event should be selected to update comment'
                    ).should('be.visible');
                    cy.get("input[type='checkbox']").eq(1).should('exist');
                    if (!cy.get('td').eq(22).contains('sample summary')) {
                      cy.get("input[type='checkbox']")
                        .eq(1)
                        .should('not.be.disabled')
                        .check();
                      cy.get('button').contains('Certify Event').click();
                      cy.get('.ant-modal-content')
                        .should('exist')
                        .and('be.visible');
                      cy.get('.ant-modal-title')
                        .contains('Certify Event')
                        .should('be.visible');
                      cy.get('button').eq(6).should('be.visible');
                      cy.get('textarea').eq(0).type('sample summary');
                      cy.get('button').eq(6).click();
                      cy.wait(12000);
                      cy.contains('Certifier comment has been updated').should(
                        'be.visible'
                      );
                      cy.get("input[type='checkbox']")
                        .eq(1)
                        .should('be.disabled');
                      cy.get('td')
                        .eq(22)
                        .contains('sample summary')
                        .should('be.visible');
                    }

                    cy.contains('View').eq(0).should('exist');
                    cy.contains('View').eq(0).click();
                    cy.wait(2000);
                    cy.get('nav').contains('Home').should('exist');
                    cy.get('nav').contains('Events').should('exist');
                    cy.get('nav')
                      .contains(body.data[0].eventTypename)
                      .should('exist');
                    cy.get('nav').contains('Serial Number').should('exist');
                  });
                });
              });
            });
          });
        });
      });
    }
  });
});

Cypress.Commands.add('payment', () => {
  cy.origin(Cypress.env('stripe_url'), () => {
    cy.wait(10000);
    cy.get('#email');
    cy.get('#email').type(`demo_@gmail.com`);
    cy.get('#cardNumber').type('4242 4242 4242 4242');
    cy.get('#cardExpiry').type(
      '12' + (new Date().getFullYear() + 10).toString().substr(-2)
    );
    cy.get('#cardCvc').type('855');
    cy.get('#billingName').type('Tanuj Soni');
    cy.get('#billingPostalCode').type('12345');
    cy.get('#enableStripePass').uncheck();
    cy.wait(10000);
  });
});
