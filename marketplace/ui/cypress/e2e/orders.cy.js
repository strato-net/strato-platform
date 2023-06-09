import dayjs from "dayjs";

describe("Renders Orders Page", () => {

  it("it should create an order", () => {
    cy.visit('/')
    cy.get("#Login").click();
    cy.login()

    cy.get("#Art", { timeout: 20000 }).click();
    cy.get("#Marketplace", { timeout: 20000 }).should("exist");
    cy.get("#Marketplace").click();
    cy.url().should("include", "/marketplace");

    cy.get("#Art", { timeout: 20000 }).should("exist");
    cy.get("#Art").click();

    cy.get("#buy-now-button", { timeout: 20000 }).should("exist");
    cy.get("#buy-now-button").click();
    cy.url().should("include", "/marketplace/checkout");
    cy.get("#submit-order-button").should("exist");
    cy.get("#submit-order-button").click();
    cy.url().should("include", "/marketplace/confirmOrder");

    cy.request({
      method: "GET",
      url: "/api/v1/order/userAddresses/user",
    }).then(({ status, body }) => {
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
    cy.get("#pay-later-button", { timeout: 20000 }).should("exist");
    cy.get("#pay-later-button").click();
    cy.get("#modal-title").contains("Confirm Order");
    cy.get("#yes-button").should("exist");
    cy.get("#yes-button").click();

    cy.contains("Order created successfully", { timeout: 30000 }).should("be.visible");
    cy.url().should("include", "/orders");
  });

  it("it should able to cancel order as a buyer", () => {
    cy.visit('/')
    cy.get("#Login").click();
    cy.login()

    cy.get("#Orders", { timeout: 20000 }).should("exist");
    cy.get("#Orders").click();
    cy.url().should("include", "/orders");
    const org = Cypress.env("buyerOrg");
    cy.get("#bought-tab").should("exist");
    cy.get("#bought-tab").click();
    cy.request({
      method: "GET",
      url: `/api/v1/order?buyerOrganization=${org}`,
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      if (body.data.length != 0) {
        const order = body.data.find((obj) => obj.status === 1);
        if (order) {
          cy.get(`#${order.orderId}`, { timeout: 20000 }).should("exist");
          cy.get(`#${order.orderId}`, { timeout: 20000 }).click({ force: true });
          cy.url().should(`include`, `/bought-orders/${order.address}`);

          cy.get('textarea[placeholder="Enter Comments"]', { timeout: 20000 }).type("I want to cancel this order");
          cy.get("#cancel-order-button").should("exist");
          cy.get("#cancel-order-button").click();

          cy.contains("Order has been updated", { timeout: 30000 }).should("be.visible");
        }
      }
    });
  });

  it("it should able to cancel order as a seller", () => {
    cy.visit('/')
    cy.get("#Login").click();
    cy.loginAsSeller()

    cy.get("#Orders", { timeout: 20000 }).should("exist");
    cy.get("#Orders").click();
    cy.url().should("include", "/orders");
    const org = "BlockApps";
    cy.get("#sold-tab").should("exist");
    cy.get("#sold-tab").click();
    cy.request({
      method: "GET",
      url: `/api/v1/order?sellerOrganization=${org}`,
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      if (body.data.length != 0) {
        const order = body.data.find((obj) => obj.status === 1);
        if (order) {
          cy.get(`#${order.orderId}`).should("exist");
          cy.get(`#${order.orderId}`).click({ force: true });
          cy.wait(30000);
          cy.url().should(`include`, `/sold-orders/${order.address}`);

          cy.get('textarea[placeholder="Enter Comments"]', { timeout: 20000, force: true }).type("I want to cancel this order");
          cy.get('.ant-select-selector').click();
          cy.contains('.ant-select-item-option-content', 'Canceled').click();
          cy.get("#yes-button").should("exist");
          cy.get("#yes-button").click();

          cy.contains("Order has been updated", { timeout: 30000 }).should("be.visible");
        }
      }
    });
  });

  it("it should allow seller to change the order status to awaiting shipment", () => {
    cy.visit('/')
    cy.get("#Login").click();
    cy.loginAsSeller()

    cy.get("#Orders", { timeout: 20000 }).should("exist");
    cy.get("#Orders").click();
    cy.url().should("include", "/orders");
    const org = Cypress.env("sellerOrg");
    cy.get("#sold-tab").should("exist");
    cy.get("#sold-tab").click();
    cy.request({
      method: "GET",
      url: `/api/v1/order?sellerOrganization=${org}`,
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      if (body.data.length != 0) {
        const order = body.data.find((obj) => obj.status === 1);
        if (order) {
          cy.get(`#${order.orderId}`).should("exist");
          cy.get(`#${order.orderId}`).click();
          cy.wait(20000);

          cy.url().should(`include`, `/sold-orders/${order.address}`);
          cy.get("#upload-button", { timeout: 20000 }).should("exist");
          cy.get("#upload-button").click();
          cy.get(".ant-upload").contains("Upload CSV").should("exist")
          cy.get('input[type="file"]').selectFile('cypress/fixtures/sample_1.csv', { force: true })
          cy.get("#confirm-button").should("exist");
          cy.get("#confirm-button").click();

          cy.contains("Item created successfully", { timeout: 20000 }).should("be.visible");
        }
      }
    });
  });

  it("it should allow seller to change the order status to closed", () => {
    cy.visit('/')
    cy.get("#Login").click();
    cy.loginAsSeller()

    cy.get("#Orders", { timeout: 20000 }).should("exist");
    cy.get("#Orders").click();
    cy.url().should("include", "/orders");
    const org = Cypress.env("sellerOrg");
    cy.get("#sold-tab").should("exist");
    cy.get("#sold-tab").click();
    cy.request({
      method: "GET",
      url: `/api/v1/order?sellerOrganization=${org}`,
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      if (body.data.length != 0) {
        const order = body.data.find((obj) => obj.status === 2);
        if (order) {
          cy.get(`#${order.orderId}`).should("exist");
          cy.get(`#${order.orderId}`).click();
          cy.url().should(`include`, `/sold-orders/${order.address}`);

          cy.get('textarea[placeholder="Enter Comments"]', { timeout: 20000 }).type("I want to close this order");
          cy.get('.ant-picker-input').click();
          cy.get('.ant-picker-date-panel')
            .contains('.ant-picker-cell', dayjs().date()).click();
          cy.get("#save-button").should("exist");
          cy.get("#save-button").click();

          cy.contains("Order has been updated", { timeout: 20000 }).should("be.visible");
        }
      }
    });
  });
});
