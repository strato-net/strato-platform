import { INVENTORY_STATUS } from '../../src/helpers/constants';
import dayjs from 'dayjs';

describe('Renders Inventory Page', () => {
  beforeEach(function () {
    cy.visit('/');
    cy.get('#Login').click();
    cy.login();
  });

  it('it should render empty inventory list page', () => {
    cy.get('#Inventory').should('exist');
    cy.get('#Inventory').click();
    cy.url().should('include', '/inventories');
    cy.request({
      method: 'GET',
      url: '/api/v1/inventory',
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      if (body.data.length == 0) {
        cy.contains('No inventory found').should('be.visible');
        cy.contains('Start adding your inventory').should('be.visible');
        cy.get('#add-inventory-button').should('exist');
      }
    });
  });

  it('it should create an inventory', () => {
    cy.intercept({
      method: 'GET',
      url: '/api/v1/product?isDeleted=false&category=Art&subCategory=Art',
    }).as('productNameCall');

    const productName = `Corn-Seeds-${dayjs().unix()}`;

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
    cy.get('input[placeholder="Enter Quantity"]').type('1');
    cy.get('input[placeholder="Enter Price"]').type('1000');
    cy.get('input[placeholder="Enter Batch ID"]').type('ABC123');
    cy.get('.ant-upload').contains('Upload CSV').should('exist');
    cy.get('input[type="file"]').selectFile('cypress/fixtures/base_seed.csv', {
      force: true,
    });
    cy.get('button').contains('Create Inventory').should('be.visible');
    cy.get('button').contains('Create Inventory').click();
    cy.contains('Inventory created successfully').should('be.visible');
  });

  it('it should create an inventory without serial number', () => {
    cy.intercept({
      method: 'GET',
      url: '/api/v1/product?isDeleted=false&category=Art&subCategory=Art',
    }).as('productNameCall');

    const productName = `Corn-Seeds-${dayjs().unix()}`;
    cy.createProduct(productName);

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
    cy.get('input[placeholder="Enter Quantity"]').type('1');
    cy.get('input[placeholder="Enter Price"]').type('1000');
    cy.get('input[placeholder="Enter Batch ID"]').type('ABC123');
    cy.get('.ant-upload').contains('Upload CSV').should('exist');
    cy.get('button').contains('Create Inventory').should('be.visible');
    cy.get('button').contains('Create Inventory').click();
    cy.contains('Inventory created successfully').should('be.visible');
  });

  it('it should render inventory list page', () => {
    cy.get('#Inventory').should('exist');
    cy.get('#Inventory').click();
    cy.url().should('include', '/inventories');
    cy.request({
      method: 'GET',
      url: '/api/v1/inventory',
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      if (body.data.length !== 0) {
        const details = body.data[0];
        const inventoryList = cy.get('#inventory-list').children();
        inventoryList.get('#0').find('img').should('have.attr', 'src');
        inventoryList
          .get('#0')
          .contains(decodeURIComponent(details.name))
          .should('be.visible');
        inventoryList.get('#0').contains('Manufacturer').should('be.visible');
        inventoryList
          .get('#0')
          .contains(decodeURIComponent(details.manufacturer))
          .should('be.visible');
        inventoryList.get('#0').contains('Price Per Unit').should('be.visible');
        inventoryList
          .get('#0')
          .contains(details.pricePerUnit)
          .should('be.visible');
        inventoryList
          .get('#0')
          .contains('Least Sellable Unit')
          .should('be.visible');
        inventoryList
          .get('#0')
          .contains(details.leastSellableUnit)
          .should('be.visible');
        inventoryList.get('#0').contains('Batch ID').should('be.visible');
        inventoryList.get('#0').contains(details.batchId).should('be.visible');
        inventoryList
          .get('#0')
          .contains('Remaining Quantity')
          .should('be.visible');
        inventoryList
          .get('#0')
          .contains(details.availableQuantity)
          .should('be.visible');
        inventoryList.get('#0').contains('Serial Numbers').should('be.visible');
        inventoryList.get('#0').contains('View').should('be.visible');
        inventoryList
          .get('#0')
          .contains(INVENTORY_STATUS[details.status])
          .should('be.visible');
        const status = details.isActive ? 'Active' : 'Inactive';
        inventoryList.get('#0').contains(status).should('be.visible');
        inventoryList
          .get('#0')
          .get('button')
          .contains('Preview')
          .should('be.visible');

        //side menu
        inventoryList.get('#0').get('.ant-popover-open').should('not.exist');
        inventoryList.get('#0').get('.anticon-more').should('exist');
        inventoryList.get('#0').get('.anticon-more').eq(0).click();
        inventoryList
          .get('#0')
          .get('.ant-popover-open')
          .eq(0)
          .should('be.visible');
        inventoryList.get('#0').get('#sideMenu').should('be.visible');
        inventoryList
          .get('#0')
          .get('#sideMenu')
          .contains('View Event')
          .should('be.visible');
        inventoryList
          .get('#0')
          .get('#sideMenu')
          .contains('Add Event')
          .should('be.visible');
        inventoryList
          .get('#0')
          .get('#sideMenu')
          .contains('Edit')
          .should('be.visible');
      }
    });
  });

  it('it should edit an inventory', () => {
    cy.get('#Inventory').should('exist');
    cy.get('#Inventory').click();
    cy.url().should('include', '/inventories');

    cy.request({
      method: 'GET',
      url: '/api/v1/inventory',
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      const inventoryList = cy.get('#inventory-list').children();
      console.log(inventoryList);
      inventoryList.get('#0').get('.anticon-more').should('exist');
      inventoryList.get('#0').get('.anticon-more').eq(0).click();
      inventoryList
        .get('#0')
        .get('#sideMenu')
        .contains('Edit')
        .should('be.visible');
      inventoryList.get('#0').get('#sideMenu').contains('Edit').click();
      cy.get('.ant-modal-content').should('exist');
      cy.contains('Edit Inventory').should('be.visible');

      cy.get('#category').should('be.disabled');
      cy.get('#subCategory').should('be.disabled');
      cy.get('#product').should('be.disabled');
      cy.get('input[name="quantity"]').should('be.disabled');
      cy.get('input[name="pricePerUnit"]').should('be.enabled');
      cy.get('input[name="batchId"]').should('be.disabled');
      cy.get('[value="true"]').should('exist');
      cy.get('[value="false"]').should('exist');
      cy.get('button').should('be.enabled').contains('Update Inventory');
      cy.get('[value="false"]').check();
      cy.get('button').contains('Update Inventory').click();
      cy.contains('Inventory has been updated').should('be.visible');

      cy.get('#inventory-list')
        .children()
        .first()
        .contains('Unpublished')
        .should('be.visible');
    });
  });

  it('it should preview an inventory', () => {
    cy.get('#Inventory').should('exist');
    cy.get('#Inventory').click();
    cy.url().should('include', '/inventories');
    cy.request({
      method: 'GET',
      url: '/api/v1/inventory',
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      let inventory = body.data[0];

      cy.get('#inventory-list')
        .children()
        .get('#0')
        .get('button')
        .contains('Preview')
        .should('exist');
      cy.get('#inventory-list')
        .children()
        .get('#0')
        .get('button')
        .contains('Preview')
        .click();

      cy.url().should('include', '/inventories');
      cy.get('nav').contains('Home').should('exist');
      cy.get('nav')
        .contains(decodeURIComponent(inventory.name))
        .should('exist');
      cy.get('div').find('img').should('have.attr', 'src');
      cy.get('#addToCart').should('exist').and('be.disabled');
      cy.get('#buyNow').should('exist').and('be.disabled');

      cy.get('#details')
        .contains(decodeURIComponent(inventory.name))
        .should('be.visible');
      if (inventory.description)
        cy.get('#details')
          .contains(decodeURIComponent(inventory.description))
          .should('exist');
      cy.get('#details')
        .contains(`$ ${inventory.pricePerUnit}`)
        .should('be.visible');
      cy.get('#details').contains('Quantity').should('be.visible');
      cy.get('#details').get('#quantity').should('exist');
      cy.get('.ant-tabs-tab').should('have.length', 4);
      cy.get('.ant-tabs-tab')
        .first()
        .should('have.class', 'ant-tabs-tab-active');
      cy.get('.ant-tabs-tab')
        .eq(1)
        .should('not.have.class', 'ant-tabs-tab-active');
      cy.contains('Product Id').should('be.visible');
      cy.contains('Unique Product Code').should('be.visible');
      cy.contains('Manufacturer').should('be.visible');
      cy.contains('Unit of Measurement').should('be.visible');
      cy.contains('Least Sellable Unit').should('be.visible');

      cy.get('.ant-tabs-tab').eq(1).click();
      cy.get('.ant-tabs-tab').eq(1).should('have.class', 'ant-tabs-tab-active');
      cy.get('.ant-tabs-tab')
        .first()
        .should('not.have.class', 'ant-tabs-tab-active');
      cy.get('th').contains('NAME').should('be.visible');
      cy.get('th').contains('DESCRIPTION').should('be.visible');

      cy.get('.ant-tabs-tab').eq(2).click();
      cy.get('.ant-tabs-tab').eq(2).should('have.class', 'ant-tabs-tab-active');
      cy.get('th').contains('SERIAL NUMBER').should('be.visible');
      cy.get('th').contains('ITEM NUMBER').should('be.visible');
      cy.request({
        method: 'GET',
        url: `/api/v1/item?inventoryId=${inventory.address}`,
      }).then(({ status, body }) => {
        expect(status).to.eq(200);
        if (body.data.length > 0) {
          cy.get(`#Ownership-Item-Number-${body.data[0].itemNumber}`).click();
          cy.get('.ownership')
            .contains('Ownership History')
            .should('be.visible');
          cy.get('#ownership-serial')
            .contains('SERIAL NUMBER')
            .should('be.visible');
          cy.get('.ownership').should('exist');
          cy.get('.ownership').contains('SELLER').should('exist');
          cy.get('.ownership').contains('OWNER').should('exist');
          cy.get('.ownership').contains('OWNERSHIP START DATE').should('exist');
        }

        if (body.data.length > 1) {
          cy.get(`#Ownership-Item-Number-${body.data[0].itemNumber}`).click();

          cy.get('.ownership')
            .contains('Ownership History')
            .should('be.visible');
          cy.get('#ownership-serial')
            .contains('SERIAL NUMBER')
            .should('be.visible');
          cy.get('.ownership').should('exist');
          cy.get('.ownership').contains('SELLER').should('exist');
          cy.get('.ownership').contains('OWNERSHIP START DATE').should('exist');
        }
      });

      cy.get('.ant-tabs-tab').eq(3).click();
      cy.get('.ant-tabs-tab').eq(3).should('have.class', 'ant-tabs-tab-active');
      cy.get('th').contains('SERIAL NUMBER').should('exist');
      cy.get('th').contains('ITEM NUMBER').should('exist');

      cy.request({
        method: 'GET',
        url: `/api/v1/item?inventoryId=${inventory.address}`,
      }).then(({ status, body }) => {
        expect(status).to.eq(200);
        if (body.data.length > 0) {
          cy.get(
            `#Transformation-Item-Number-${body.data[0].itemNumber}`
          ).click();

          cy.get('.transformation')
            .contains('Transformation')
            .should('be.visible');
          cy.get('.transformation')
            .contains('SERIAL NUMBER')
            .should('be.visible');
          cy.get('#trans-serial').should('exist');
          cy.get('.transformation').contains('RAW MATERIALS').should('exist');
          cy.get('.transformation').contains('SERIAL NUMBER').should('exist');
        }
      });
    });
  });

  it('it should add event to an inventory', () => {
    cy.intercept({
      method: 'GET',
      url: '/api/v1/product?isDeleted=false&category=Art&subCategory=Art',
    }).as('productNameCall');

    const productName = `Corn-Seeds-${dayjs().unix()}`;
    cy.createProduct(productName);
    cy.createInventory(productName);

    cy.get('#Inventory').should('exist');
    cy.get('#Inventory').click();
    cy.url().should('include', '/inventories');

    cy.request({
      method: 'GET',
      url: '/api/v1/inventory',
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      const inventoryList = cy.get('#inventory-list').children();
      inventoryList.get('#0').get('.anticon-more').should('exist');
      inventoryList.get('#0').get('.anticon-more').eq(0).click();
      inventoryList
        .get('#0')
        .get('#sideMenu')
        .contains('Add Event')
        .should('be.visible');
      inventoryList.get('#0').get('#sideMenu').contains('Add Event').click();
      cy.get('.ant-modal-content').should('exist');
      cy.contains('Add Event').should('be.visible');
      cy.get('#eventType').type('{enter}{enter}');
      cy.get('#certifier').type('Achin Kumar{enter}{enter}');
      cy.get('textarea').eq(0).type('summary');
      cy.get('.ant-picker-input').type('04/05/2023{enter}');
      cy.get('button').contains('Add Event').should('be.visible');
      cy.get('button').contains('Add Event').click();
      cy.contains('Event created successfully').should('be.visible');
    });
  });

  it('it should render events list of an inventory', () => {
    cy.get('#Inventory').should('exist');
    cy.get('#Inventory').click();
    cy.url().should('include', '/inventories');

    cy.request({
      method: 'GET',
      url: '/api/v1/inventory',
    }).then(({ status, body }) => {
      expect(status).to.eq(200);

      const inventoryList = cy.get('#inventory-list').children();
      inventoryList.get('#0').get('.anticon-more').should('exist');
      inventoryList.get('#0').get('.anticon-more').eq(0).click();
      inventoryList
        .get('#0')
        .get('#sideMenu')
        .contains('View Event')
        .should('be.visible');
      inventoryList.get('#0').get('#sideMenu').contains('View Event').click();

      cy.get('nav').contains('Home').should('exist');
      cy.get('nav').contains('Inventory').should('exist');
      cy.get('nav').contains('Events').should('exist');
      cy.get('th').contains('NAME').should('be.visible');
      cy.get('th').contains('DESCRIPTION').should('be.visible');
    });
  });
});
