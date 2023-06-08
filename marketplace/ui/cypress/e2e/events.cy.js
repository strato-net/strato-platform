import dayjs from "dayjs";

describe("Renders Events Page", () => {
  beforeEach(function () {
    cy.visit('/')
    cy.get("#Login").click();
    cy.login()

    cy.wait(20000);
  });

  // // Success
  it("it should render empty event type list components", () => {
    cy.get("#Events").should("exist");
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

  // // Error
  it("it should add an event type", () => {
    cy.get("#Events").should("exist");
    cy.get("#Events").click();
    cy.url().should("include", "/events");
    cy.wait(10000);
    cy.get("#create-event-type-button").should("exist");
    cy.get("#create-event-type-button").click();
    cy.get("#modal-title").contains("Create Event Type");
    cy.get('input[placeholder="Event Name"]').type("Event A");
    cy.get('textarea[placeholder="Event Description"]').type("This is test event type");
    cy.get("#create-event-type").should("exist");
    cy.get("#create-event-type").click();
    cy.wait(15000);
    cy.contains("EventType created successfully").should("be.visible");
  });

  // Error
  // Error: Request failed with status code 400: Argument names don't match - Expected Arguments: (_appChainId, _certifier, _createdDate, _date, _eventBatchId, _eventTypeId, _itemsAddress, _summary); Received Arguments: (_certifier, _createdDate, _date, _eventBatchId, _eventTypeId, _itemsAddress, _productId, _serialNumbers, _summary)
  it("it should create an event", () => {
    cy.get("#Events").should("exist");
    cy.get("#Events").click();
    cy.url().should("include", "/events");
    cy.wait(10000);
    cy.get("#event-tab").should("exist");
    cy.get("#event-tab").click();
    cy.get("#create-event-button").should("exist");
    cy.get("#create-event-button").click();
    cy.wait(10000);
    cy.get("#modal-title").contains("Add Event");
    cy.get("#category").type("Art{enter}");
    cy.get("#subCategory").type("Art{enter}");
    cy.wait(20000);
    cy.get("#product").should("be.enabled").type("{enter}{enter}");
    cy.get('.ant-picker-input').click();
    cy.get('.ant-picker-date-panel')
      .contains('.ant-picker-cell', dayjs().date()).click();
    cy.get("#certifier").should("be.enabled").type("{enter}{enter}");
    cy.get("#event-type").should("be.enabled").type("{enter}{enter}");
    cy.get('textarea[placeholder="Enter summary"]').type("This is test summary");
    cy.get(".ant-upload").contains("Upload CSV").should("exist")
    cy.get('input[type="file"]').selectFile('cypress/fixtures/sample_1.csv', { force: true });
    cy.get("#add-event-button").should("exist");
    cy.get("#add-event-button").click();
    cy.wait(15000);
    cy.contains("Event created successfully").should("be.visible");
  });

  // TODO: Atleast one event should be selected to update comment
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
