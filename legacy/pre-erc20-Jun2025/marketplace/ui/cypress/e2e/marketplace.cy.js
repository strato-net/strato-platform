import dayjs from 'dayjs';

describe('Renders Marketplace Page', () => {
  it('it should render marketplace dashboard', () => {
    cy.visit('/');
    cy.get('#Login').click();
    cy.login();

    cy.url().should('include', '/marketplace');
    cy.contains('Explore New Products').should('exist');
    cy.get('.relative')
      .find('img')
      .should('have.attr', 'src')
      .should('include', 'hero');
    cy.get('#viewMore').contains('View More').should('exist');
    cy.request({
      method: 'GET',
      url: '/api/v1/category',
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      cy.contains('Categories').should('be.visible');

      if (body.data.length !== 0) {
        let name = body.data[0].name;
        cy.contains(name).should('be.visible');
      }
    });
    cy.request({
      method: 'GET',
      url: '/api/v1/marketplace/user/topSelling?offset=0',
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      cy.contains('Top Selling Products').should('be.visible');
      if (body.data.length !== 0) {
        let name = decodeURIComponent(body.data[0].name);
        cy.contains(name).should('be.visible');
      }
      cy.get('#topSelling').children().should('have.length', 3);
    });
  });

  it('it should render product list page', () => {
    cy.visit('/');
    cy.get('#Login').click();
    cy.login();

    cy.url().should('contain', 'marketplace');
    cy.get('#viewMore').should('be.enabled').click();

    cy.url().should('contain', '/marketplace/category');
    cy.get('nav').contains('Home').should('exist');
    cy.contains('Filters').should('exist');
    cy.contains('Categories').should('exist');
    cy.contains('Price').should('exist');
    cy.contains('Quantity').should('exist');
    cy.contains('Sub-Category').should('exist');
    cy.contains('Product').should('exist');
    cy.contains('Products found').should('be.visible');
    cy.get('#product-list').should('exist');
    cy.request({
      method: 'GET',
      url: '/api/v1/marketplace/all?range[]=quantity,0,1000000&range[]=pricePerUnit,0,100000000',
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      cy.get('#product-list')
        .children()
        .should('have.length', body.data.length);
    });
  });

  it('it should render sub-categories, products, brands and inventories on selecting categories', () => {
    cy.visit('/');
    cy.get('#Login').click();
    cy.login();

    cy.url().should('contain', 'marketplace');
    cy.get('#viewMore').should('be.enabled').click();

    cy.url().should('contain', '/marketplace/category');
    cy.get('nav').contains('Home').should('exist');
    cy.contains('Filters').should('exist');
    cy.contains('Categories').should('exist');
    cy.contains('Price').should('exist');
    cy.contains('Quantity').should('exist');
    cy.contains('Sub-Category').should('exist');
    cy.contains('Product').should('exist');

    cy.request({
      method: 'GET',
      url: '/api/v1/marketplace/all?range[]=quantity,0,1000000&range[]=pricePerUnit,0,100000000',
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      cy.contains(`${body.data.length} Products found`).should('be.visible');
      cy.get('#product-list')
        .children()
        .should('have.length', body.data.length);
      if (body.data.length > 0) {
        let card = cy.get('#product-list').children().first();
        card.find('img').should('have.attr', 'src');
        card.get('#prod-name').should('be.visible');
        card.get('#prod-category').should('exist');
        card.get('#prod-desc').should('exist');
        card.get('#prod-price').should('be.visible');
        card.get('#prod-quantity').should('be.visible');
        card.get('button').contains('Add To Cart').should('exist');
        card.get('button').contains('Buy Now').should('exist');
      }
    });

    cy.request({
      method: 'GET',
      url: '/api/v1/category',
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      if (body.data.length !== 0) {
        let category = body.data[0];
        cy.get('[type="checkbox"]').check(category.name);
        cy.contains('Sub-Category').should('exist');

        cy.request({
          method: 'GET',
          url: `api/v1/product/filter/names?isDeleted=false&&category[]=${category.name}`,
        }).then(({ status, body }) => {
          expect(status).to.eq(200);
          if (body.data.length !== 0) {
            cy.contains('Product').should('exist');
          }
        });

        cy.request({
          method: 'GET',
          url: `/api/v1/marketplace/all?&category[]=${category.name}&range[]=quantity,0,1000000&range[]=pricePerUnit,0,100000000`,
        }).then(({ status, body }) => {
          expect(status).to.eq(200);
          cy.contains(`${body.data.length} Products found`).should(
            'be.visible'
          );
          cy.get('#product-list')
            .children()
            .should('have.length', body.data.length);
        });
      }
    });
  });

  it('it should render inventories based on filter selection', () => {
    cy.visit('/');
    cy.get('#Login').click();
    cy.login();

    cy.url().should('contain', 'marketplace');
    cy.get('#viewMore').should('be.enabled').click();
    cy.url().should('contain', '/marketplace/category');

    let category, subCategory, product;
    cy.request({
      method: 'GET',
      url: '/api/v1/category',
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      if (body.data.length !== 0) {
        category = body.data[0];
        cy.get('[type="checkbox"]').check(category.name);
        cy.wait(15000);

        // TO be confirm
        cy.request({
          method: 'GET',
          url: `api/v1/subcategory?category[]=${category.name}`,
        }).then(({ status, body }) => {
          expect(status).to.eq(200);
          if (body.data.length !== 0) {
            subCategory = body.data[0];
            cy.contains('Sub-Category').should('exist');
            cy.get('[type="checkbox"]').check(subCategory.name);
            let productUrl = subCategory
              ? `api/v1/product/filter/names?isDeleted=false&&category[]=${category.name}&subCategory[]=${subCategory.name}`
              : `api/v1/product/filter/names?isDeleted=false&&category[]=${category.name}`;

            cy.request({
              method: 'GET',
              url: productUrl,
            }).then(({ status, body }) => {
              expect(status).to.eq(200);
              if (body.data.length !== 0) {
                product = body.data[0];
                cy.contains('Product').should('exist');
                cy.get('[type="checkbox"]').check(product.manufacturer);
                cy.wait(5000);

                cy.request({
                  method: 'GET',
                  url: `/api/v1/marketplace/all?&category[]=${category.name}&subCategory[]=${subCategory.name}&manufacturer[]=${product.manufacturer}&range[]=quantity,0,1000000&range[]=pricePerUnit,0,100000000`,
                }).then(({ status, body }) => {
                  expect(status).to.eq(200);
                  cy.contains(`${body.data.length} Products found`).should(
                    'be.visible'
                  );
                  cy.get('#product-list')
                    .children()
                    .should('have.length', body.data.length);
                  if (body.data.length === 0) {
                    cy.contains('No data found');
                  }
                });
              }
            });
          }
        });
      }
    });
  });

  it('it should render product detail page', () => {
    cy.visit('/');
    cy.get('#Login').click();
    cy.login();

    cy.request({
      method: 'GET',
      url: `/api/v1/marketplace/user/topselling?offset=0`,
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      cy.wait(30000);

      if (body.data.length !== 0) {
        let inventory = body.data[0];
        cy.get('#topSelling').should('exist');
        cy.get('#topSellingChild').should('exist');
        cy.get('#topSelling').children().first().click();

        cy.url().should('include', '/marketplace/productList/');
        cy.get('nav').contains('Home').should('exist');
        cy.get('nav')
          .contains(decodeURIComponent(inventory.name))
          .should('exist');
        cy.get('div').find('img').should('have.attr', 'src');
        cy.get('button').contains('Add To Cart').should('exist');
        cy.get('button').contains('Buy Now').should('exist');

        cy.contains(decodeURIComponent(inventory.name)).should('be.visible');
        if (inventory.description)
          cy.get('#details')
            .contains(decodeURIComponent(inventory.description))
            .should('exist');
        cy.get('#details')
          .contains(`$ ${inventory.pricePerUnit}`)
          .should('be.visible');
        cy.get('#details').contains('Quantity').should('be.visible');
        cy.get('#quantity').should('exist');
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
        cy.get('.ant-tabs-tab')
          .eq(1)
          .should('have.class', 'ant-tabs-tab-active');
        cy.get('.ant-tabs-tab')
          .first()
          .should('not.have.class', 'ant-tabs-tab-active');
        cy.get('th').contains('NAME').should('be.visible');
        cy.get('th').contains('DESCRIPTION').should('be.visible');

        cy.get('.ant-tabs-tab').eq(2).click();
        cy.get('.ant-tabs-tab')
          .eq(2)
          .should('have.class', 'ant-tabs-tab-active');
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
            cy.get('#ownership-serial').should('exist');
            cy.get('.ownership').contains('SELLER').should('exist');
            cy.get('.ownership').contains('OWNER').should('exist');
            cy.get('.ownership')
              .contains('OWNERSHIP START DATE')
              .should('exist');
          }

          if (body.data.length > 1) {
            cy.get(`#Ownership-Item-Number-${body.data[0].itemNumber}`).click();

            cy.get('.ownership')
              .contains('Ownership History')
              .should('be.visible');
            cy.get('#ownership-serial')
              .contains('SERIAL NUMBER')
              .should('be.visible');
            cy.get('#ownership-serial').should('exist');
            cy.get('.ownership').contains('SELLER').should('exist');
            cy.get('.ownership')
              .contains('OWNERSHIP START DATE')
              .should('exist');
          }
        });

        cy.get('.ant-tabs-tab').eq(3).click();
        cy.get('.ant-tabs-tab')
          .eq(3)
          .should('have.class', 'ant-tabs-tab-active');
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

            cy.get('#transformation')
              .contains('Transformation')
              .should('be.visible');
            cy.get('#transformation')
              .contains('SERIAL NUMBER')
              .should('be.visible');
            cy.get('#trans-serial').should('exist');
            cy.get('#transformation').contains('RAW MATERIALS').should('exist');
            cy.get('#transformation').contains('SERIAL NUMBER').should('exist');
          }
        });
      }
    });
  });

  it('Unpublish and Inventory and it should not appear in Marketplace for other Buyers', () => {
    cy.intercept({
      method: 'GET',
      url: '/api/v1/product?isDeleted=false&category=Art&subCategory=Art',
    }).as('productNameCall');

    cy.visit('/');
    cy.get('#Login').click();
    cy.login();

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
    cy.get('[value="false"]').check();
    cy.get('button').contains('Create Inventory').should('be.visible');
    cy.get('button').contains('Create Inventory').click();
    cy.contains('Inventory created successfully').should('be.visible');
    cy.get('#inventory-list')
      .children()
      .first()
      .contains('Unpublished')
      .should('be.visible');
    cy.get('#user-dropdown').click();
    cy.get('#logout').click();
    cy.get('#Orders').should('not.exist');

    cy.get('#Login').click();
    cy.loginAsSeller();
    cy.get('#Marketplace').should('exist');
    cy.url().should('contain', 'marketplace');
    cy.get('#viewMore').should('be.enabled').click();
    cy.url().should('contain', '/marketplace/category');

    cy.request({
      method: 'GET',
      url: '/api/v1/category',
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      if (body.data.length !== 0) {
        let category = body.data[0];
        cy.get('[type="checkbox"]').check(category.name);
        cy.get('#product-list').should('exist');
        cy.contains(productName).should('not.exist');
      }
    });
  });
});
