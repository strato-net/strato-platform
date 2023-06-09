import dayjs from "dayjs";

describe("Renders Events Page", () => {
  beforeEach(function () {
    cy.visit('/')
    cy.get("#Login").click();
    
    cy.loginAsSeller()
  });

  it("it should render empty event type list components", () => {
    cy.get("#Events", { timeout: 20000 }).should("exist");
    cy.get("#Events").click();
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
    cy.get("#Events", { timeout: 20000 }).should("exist");
    cy.get("#Events").click();
    cy.url().should("include", "/events");

    cy.get("#create-event-type-button", { timeout: 20000 }).should("exist");
    cy.get("#create-event-type-button").click();
    cy.get("#modal-title").contains("Create Event Type");
    cy.get('input[placeholder="Event Name"]').type("Event A");
    cy.get('textarea[placeholder="Event Description"]').type("This is test event type");
    cy.get("#create-event-type").should("exist");
    cy.get("#create-event-type").click();

    cy.contains("EventType created successfully", { timeout: 20000 }).should("be.visible");
  });

  it("it should create an event", () => {
    cy.createProduct();
    cy.createInventory();

    cy.get("#Events", { timeout: 20000 }).should("exist");
    cy.get("#Events").click();
    cy.url().should("include", "/events");

    cy.get("#event-tab", { timeout: 20000 }).should("exist");
    cy.get("#event-tab").click();
    cy.get("#create-event-button").should("exist");
    cy.get("#create-event-button").click();

    cy.get("#modal-title", { timeout: 20000 }).contains("Add Event");
    cy.get("#category", { timeout: 20000 }).type("Art{enter}");
    cy.get("#subCategory").type("Art{enter}");

    cy.wait(10000)
    cy.get("#product", { timeout: 20000 }).should("be.enabled").type("{enter}{enter}");
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

    cy.contains("Event created successfully", { timeout: 20000 }).should("be.visible");
  });

  // it("it should certify an event", () => {
  //   cy.get("#Events").should("exist");
  //   cy.get("#Events").click();
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
