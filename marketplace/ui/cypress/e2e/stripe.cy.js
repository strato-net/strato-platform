import dayjs from "dayjs";

it("it should create product, inventory and buy using pay now option - success", () => {
  Cypress.on("uncaught:exception", () => {
    return false;
  });

  cy.intercept({
    method: 'POST',
    url: '/api/v1/order/payment',
  }).as('paymentCall');

  cy.intercept({
    method: 'GET',
    url: '/api/v1/product?isDeleted=false&category=Art&subCategory=Art',
  }).as('productNameCall');

  cy.visit('/')
  cy.get("#Login").click();
  cy.login(Cypress.env("singleRoleEmail"), Cypress.env("singleRolePassword"))

  const productName = `Corn Seeds ${dayjs().unix()}`;

  cy.get("#Products").should("exist");
  cy.get("#Products").click();
  cy.url().should("include", "/products");
  cy.get("#add-product-button").should("exist");
  cy.get("#add-product-button").click();
  cy.get("#modal-title").contains("Add Product");
  cy.get('input[placeholder="Enter Name"]').type(productName);
  cy.get("#category").type("Art{enter}");
  cy.get("#subCategory").type("Art{enter}");
  cy.get('input[placeholder="Enter Manufacturer"]').type("Manufacturer A");
  cy.get("#unitofmeasurement").click().type("{enter}", { force: true });
  cy.get('input[placeholder="Enter Least Sellable Unit"]').type("100");
  cy.get('textarea[placeholder="Enter Description"]').type(
    "This is a description"
  );
  cy.get("input[type=file]").attachFile("cottonSeeds.jpg");
  cy.get('input[placeholder="Enter Unique Product Code"]').type("x_103");
  cy.get("#create-product-button").should("exist");
  cy.get("#create-product-button").click();
  cy.contains("Product created successfully").should("be.visible");

  cy.get("#Inventory").should("exist");
  cy.get("#Inventory").click();
  cy.url().should("include", "/inventories");
  cy.get("#Inventory").should("exist");
  cy.get("#Inventory").click();
  cy.url().should("include", "/inventories");
  cy.get("button").contains("Add Inventory").should("exist");
  cy.get("button").contains("Add Inventory").click();
  cy.get(".ant-modal-content").should("exist").and("be.visible");
  cy.contains("Add Inventory").should("be.visible");
  cy.get("#category").type("Art{enter}");
  cy.get("#subCategory").type("Art{enter}");

  cy.get("#product").should("be.enabled");

  cy.get("#product").click()
  cy.wait('@productNameCall')
    .its('response.body')
    .then((body) => {
      console.log(body);
      cy.wait(500);
      cy
        .get('.ant-select-dropdown :not(.ant-select-dropdown-hidden)')
        .find('.ant-select-item-option')
        .each(el => {
          if (el.text() === productName) {
            cy.wait(500)
            cy.wrap(el).click();
            cy.wait(500)
          }
        })
    })
  cy.get('input[placeholder="Enter Quantity"]').type("1");
  cy.get('input[placeholder="Enter Price"]').type("1000");
  cy.get('input[placeholder="Enter Batch ID"]').type("ABC123");

  cy.get("button").contains("Create Inventory").should("be.visible");
  cy.get("button").contains("Create Inventory").click();
  cy.contains("Inventory created successfully").should("be.visible");
  cy.get("#user-dropdown").click();
  cy.get("#logout").click();
  cy.get("#Orders").should("not.exist");
  cy.get("#Login").click();

  cy.login(Cypress.env('teEmail'), Cypress.env('tePassword'));
  cy.get("#Marketplace").should("exist");
  cy.url().should("contain", "marketplace");

  cy.get("#Art").should("exist");
  cy.get("#Art").click();
  cy.get(`#${productName}-buy-now`).should("exist");
  cy.get(`#${productName}-buy-now`).click();
  cy.url().should("include", "/marketplace/checkout");
  cy.get("#submit-order-button").should("exist");
  cy.get("#submit-order-button").click();
  cy.url().should("include", "/marketplace/confirmOrder");

  cy.request({
    method: "GET",
    url: "/api/v1/order/userAddresses/user",
  }).then(({ status, body }) => {
    console.log(body)
    expect(status).to.eq(200);
    if (body.data.length == 0) {
      cy.get('input[placeholder="Enter Name"]').type("Shubham Dubey");
      cy.get('input[placeholder="Enter Zipcode"]').type("32545");
      cy.get('input[placeholder="Enter State"]').type("Dallas");
      cy.get('input[placeholder="Enter City"]').type("New york");
      cy.get('textarea[placeholder="Enter Address Line 1"]').type("Street A, near block");
      cy.get("#add-address-button").should("exist");
      cy.get("#add-address-button").click();
    }
  });
  cy.get("#pay-now-button").should("exist");
  cy.get("#pay-now-button").click();

  cy.wait('@paymentCall', { timeout: 190000 })
    .its('response.body')
    .then((body) => {
      console.log(body);
      cy.url().should("contains", "https://checkout.stripe.com/c/pay/");

      // fill stripe details
      cy.get('#email').type(Cypress.env('dualRoleEmail'));
      cy.get('#cardNumber').type('4242 4242 4242 4242');
      cy.get("#cardExpiry").type(
        "12" + (new Date().getFullYear() + 10).toString().substr(-2)
      );
      cy.get('#cardCvc').type('855');
      cy.get('#billingName').type('Nitin Gupta');
      cy.wait(1000);

      cy.get(".SubmitButton").click();
      cy.get(".SubmitButton").should(($div) => {
        expect($div.text()).to.include("Processing");
      });

      cy.url().should("include", "/marketplace/order/status");
      cy.contains("Please wait while your order is placed successfully").should("be.exist");
      cy.get('#bought-tab', { timeout: 120000 })
      cy.get('#sold-tab', { timeout: 120000 })
      cy.url().should("include", "/marketplace/orders");
    })
});

it("it should create product, inventory and buy using pay now option - insufficient fund", () => {
  Cypress.on("uncaught:exception", () => {
    return false;
  });

  cy.intercept({
    method: 'POST',
    url: '/api/v1/order/payment',
  }).as('paymentCall');

  cy.intercept({
    method: 'GET',
    url: '/api/v1/product?isDeleted=false&category=Art&subCategory=Art',
  }).as('productNameCall');

  cy.visit('/')
  cy.get("#Login").click();
  cy.login(Cypress.env("singleRoleEmail"), Cypress.env("singleRolePassword"))

  const productName = `Corn Seeds ${dayjs().unix()}`;

  cy.get("#Products").should("exist");
  cy.get("#Products").click();
  cy.url().should("include", "/products");
  cy.get("#add-product-button").should("exist");
  cy.get("#add-product-button").click();
  cy.get("#modal-title").contains("Add Product");
  cy.get('input[placeholder="Enter Name"]').type(productName);
  cy.get("#category").type("Art{enter}");
  cy.get("#subCategory").type("Art{enter}");
  cy.get('input[placeholder="Enter Manufacturer"]').type("Manufacturer A");
  cy.get("#unitofmeasurement").click().type("{enter}", { force: true });
  cy.get('input[placeholder="Enter Least Sellable Unit"]').type("100");
  cy.get('textarea[placeholder="Enter Description"]').type(
    "This is a description"
  );
  cy.get("input[type=file]").attachFile("cottonSeeds.jpg");
  cy.get('input[placeholder="Enter Unique Product Code"]').type("x_103");
  cy.get("#create-product-button").should("exist");
  cy.get("#create-product-button").click();
  cy.contains("Product created successfully").should("be.visible");

  cy.get("#Inventory").should("exist");
  cy.get("#Inventory").click();
  cy.url().should("include", "/inventories");
  cy.get("#Inventory").should("exist");
  cy.get("#Inventory").click();
  cy.url().should("include", "/inventories");
  cy.get("button").contains("Add Inventory").should("exist");
  cy.get("button").contains("Add Inventory").click();
  cy.get(".ant-modal-content").should("exist").and("be.visible");
  cy.contains("Add Inventory").should("be.visible");
  cy.get("#category").type("Art{enter}");
  cy.get("#subCategory").type("Art{enter}");
  cy.get("#product").should("be.enabled");

  cy.get("#product").click()
  cy.wait('@productNameCall')
    .its('response.body')
    .then((body) => {
      console.log(body);
      cy.wait(500);
      cy
        .get('.ant-select-dropdown :not(.ant-select-dropdown-hidden)')
        .find('.ant-select-item-option')
        .each(el => {
          if (el.text() === productName) {
            cy.wait(500)
            cy.wrap(el).click();
            cy.wait(500)
          }
        })
    })
  cy.get('input[placeholder="Enter Quantity"]').type("1");
  cy.get('input[placeholder="Enter Price"]').type("1000");
  cy.get('input[placeholder="Enter Batch ID"]').type("ABC123");

  cy.get("button").contains("Create Inventory").should("be.visible");
  cy.get("button").contains("Create Inventory").click();
  cy.contains("Inventory created successfully").should("be.visible");
  cy.get("#user-dropdown").click();
  cy.get("#logout").click();
  cy.get("#Orders").should("not.exist");
  cy.get("#Login").click();

  cy.login(Cypress.env('teEmail'), Cypress.env('tePassword'));
  cy.get("#Marketplace").should("exist");
  cy.url().should("contain", "marketplace");

  cy.get("#Art").should("exist");
  cy.get("#Art").click();
  cy.get(`#${productName}-buy-now`).should("exist");
  cy.get(`#${productName}-buy-now`).click();
  cy.url().should("include", "/marketplace/checkout");
  cy.get("#submit-order-button").should("exist");
  cy.get("#submit-order-button").click();
  cy.url().should("include", "/marketplace/confirmOrder");

  cy.request({
    method: "GET",
    url: "/api/v1/order/userAddresses/user",
  }).then(({ status, body }) => {
    console.log(body)
    expect(status).to.eq(200);
    if (body.data.length == 0) {
      cy.get('input[placeholder="Enter Name"]').type("Shubham Dubey");
      cy.get('input[placeholder="Enter Zipcode"]').type("32545");
      cy.get('input[placeholder="Enter State"]').type("Dallas");
      cy.get('input[placeholder="Enter City"]').type("New york");
      cy.get('textarea[placeholder="Enter Address Line 1"]').type("Street A, near block");
      cy.get("#add-address-button").should("exist");
      cy.get("#add-address-button").click();
    }
  });
  cy.get("#pay-now-button").should("exist");
  cy.get("#pay-now-button").click();

  cy.wait('@paymentCall', { timeout: 190000 })
    .its('response.body')
    .then((body) => {
      console.log(body);
      cy.url().should("contains", "https://checkout.stripe.com/c/pay/");

      // fill stripe details
      cy.get('#email').type(Cypress.env('dualRoleEmail'));
      cy.get('#cardNumber').type('4000 0000 0000 9995');
      cy.get("#cardExpiry").type(
        "12" + (new Date().getFullYear() + 10).toString().substr(-2)
      );
      cy.get('#cardCvc').type('855');
      cy.get('#billingName').type('Nitin Gupta');
      cy.wait(1000);

      cy.get(".SubmitButton").click();
      cy.contains('Your credit card was declined because of insufficient funds. Try paying with a debit card instead.').should('exist')
    })
});
