import dayjs from "dayjs";

describe("Renders Events Page", () => {
  beforeEach(function () {
    cy.visit('/')
    cy.get("#login").click();

    cy.login()
  });

  it("it should render empty event type list components", () => {
    cy.get("#events").should("exist");
    cy.get("#events").click();
    cy.url().should("include", "/events");
    cy.request({
      method: "GET",
      url: "/api/v1/eventType",
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      if (body.data.length == 0) {
        cy.contains("No events found").should("be.visible");
        cy.contains("Start creating event type").should("be.visible");
        cy.get("#create-event-type-button").should("exist");
      }
    });
  });

  it("it should add an event type", () => {
    cy.get("#events").should("exist");
    cy.get("#events").click();
    cy.url().should("include", "/events");

    cy.get("#create-event-type-button").should("exist");
    cy.get("#create-event-type-button").click();
    cy.get("#modal-title").contains("Create Event Type");
    cy.get('input[placeholder="Event Name"]').type("Event A");
    cy.get('textarea[placeholder="Event Description"]').type("This is test event type");
    cy.get("#create-event-type").should("exist");
    cy.get("#create-event-type").click();

    cy.contains("EventType created successfully").should("be.visible");
  });

  it("it should create an event", () => {
    cy.intercept({
      method: 'GET',
      url: '/api/v1/product?isDeleted=false&category=Art&subCategory=Art',
    }).as('productNameCall');

    const productName = `Corn-Seeds-${dayjs().unix()}`;
    cy.createProduct(productName);
    cy.createInventory(productName);

    cy.get("#events").should("exist");
    cy.get("#events").click();
    cy.url().should("include", "/events");

    cy.get("#event-tab").should("exist");
    cy.get("#event-tab").click();
    cy.get("#create-event-button").should("exist");
    cy.get("#create-event-button").click();

    cy.get("#modal-title").contains("Add Event");
    cy.get("#category").type("Art{enter}");
    cy.get("#subCategory").type("Art{enter}");

    cy.get("#product").should("be.enabled");
    cy.get("#product").click()
    cy.wait('@productNameCall')
      .its('response.body')
      .then(() => {
        cy.wait(500);
        cy.get('.ant-select-dropdown :not(.ant-select-dropdown-hidden)')
          .find('.ant-select-item-option')
          .each(el => {
            if (el.text() === productName) {
              cy.wait(500)
              cy.wrap(el).click();
              cy.wait(500)
            }
          })
      })
    cy.get('.ant-picker-input').click();
    cy.get('.ant-picker-date-panel')
      .contains('.ant-picker-cell', dayjs().date()).click();
    cy.get("#certifier").should("be.enabled").type("{enter}{enter}");
    cy.get("#event-type").should("be.enabled").type("{enter}{enter}");
    cy.get(".ant-upload").contains("Upload CSV").should("exist")
    cy.get('input[type="file"]').selectFile('cypress/fixtures/sample_1.csv', { force: true });
    cy.get('textarea[placeholder="Enter summary"]').type("This is test summary");

    cy.get("#add-event-button").should("exist");
    cy.get("#add-event-button").click();

    cy.contains("Event created successfully").should("be.visible");
  });

  // it("it should certify an event", () => {
  //   cy.get("#events").should("exist");
  //   cy.get("#events").click();
  //   cy.url().should("include", "/events");
  //   cy.wait(10000);
  //   cy.get("#certify-event-tab").should("exist");
  //   cy.get("#certify-event-tab").click();
  //   cy.wait(10000);
  //   cy.get(".ant-checkbox .ant-checkbox-input").first().click();
  //   cy.get("#certify-event-button").should("exist");
  //   cy.get("#certify-event-button").click();
  //   cy.get("#modal-title").contains("Certify Event");
  //   cy.get('textarea[placeholder="Enter comment"]').type("This is test comment");
  //   cy.get("#certify-event").should("exist");
  //   cy.get("#certify-event").click();
  //   cy.wait(15000);
  //   cy.contains("Certifier comment has been updated").should("be.visible");
  // });

});
