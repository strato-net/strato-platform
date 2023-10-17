describe("Renders Certifier Page", () => {

    it("it should render certifier homepage for certifier login", () => {
        cy.visit('/')
        cy.get("#Login").click();
        cy.login(Cypress.env("singleRoleEmail"), Cypress.env("singleRolePassword"));

        cy.wait(20000);
        cy.request({
            method: "GET",
            url: "/api/v1/users/me",
        }).then(({ status, body }) => {
            expect(status).to.eq(200);
            cy.wait(13000)
            cy.url().should("include", "/certifier");
            if (body.data.roles.includes(3) && body.data.roles.length === 1) {
                cy.get("nav").should("not.exist");
                cy.get("h5").contains("Certify Events").should("be.visible")
                cy.get("button").contains("Certify Event").should("exist")
                cy.get("th").contains("NAME").should("be.visible");
                cy.get("th").contains("DESCRIPTION").should("be.visible");
                cy.get("th").contains("DATE").should("be.visible");
                cy.get("th").contains("SUMMARY").should("be.visible");
                cy.get("th").contains("CERTIFIER").should("be.visible");
                cy.get("th").contains("CERTIFIED DATE").should("be.visible");
                cy.get("th").contains("CERTIFIER COMMENTS").should("be.visible");
                cy.get("th").contains("SERIAL NUMBER").should("be.visible");
            }
        });
    });


    it.only("it should check certifier flow for user with certifier & trading entity roles", () => {
        cy.visit('/')
        cy.get("#Login").click();
        
        cy.login(Cypress.env("dualRoleEmail"), Cypress.env("dualRolePassword"));
        cy.wait(20000);
        cy.request({
            method: "GET",
            url: "/api/v1/users/me",
        }).then(({ status, body }) => {
            expect(status).to.eq(200);
            cy.wait(20000)
            let rolesToCompare = [2, 3]
            let actualRoles = body.data.roles
            let sameMembers = rolesToCompare.every(val => actualRoles.includes(val));
            let sameLength = actualRoles.length === rolesToCompare.length;
            if (sameLength && sameMembers) {
                cy.get("#Admin").should("not.exist");
                cy.get("#Events").should("exist");
                cy.request({
                    method: "GET",
                    url: "/api/v1/eventType?limit=10&offset=0"
                }).then(({ status, body }) => {
                    expect(status).to.eq(200);
                    if(body.data.length > 0){
                        cy.get("#Events").click();
                        cy.url().should("include", "/events");
                        cy.wait(15000);
                        cy.get(".ant-tabs-tab").should("have.length", 3);
                        cy.get(".ant-tabs-tab").first().should('have.class', 'ant-tabs-tab-active')
                        cy.get(".ant-tabs-tab").eq(2).should('not.have.class', 'ant-tabs-tab-active')
                      
                        cy.get(".ant-tabs-tab").eq(2).click();
                        cy.get(".ant-tabs-tab").eq(2).should('have.class', 'ant-tabs-tab-active')
                        cy.wait(15000);
                        cy.get("button").contains("Certify Event").should("exist")
                        cy.get("th").eq(4).contains("NAME").should("be.visible");
                        cy.get("th").eq(5).contains("DESCRIPTION").should("be.visible");
                        cy.get("th").eq(6).contains("DATE").should("be.visible");
                        cy.get("th").contains("SUMMARY").should("be.visible");
                        cy.get("th").contains("CERTIFIER").should("be.visible");
                        cy.get("th").contains("CERTIFIED DATE").should("be.visible");
                        cy.get("th").contains("CERTIFIER COMMENTS").should("be.visible");
                        cy.get("th").contains("SERIAL NUMBER").should("be.visible");
                        cy.certifyEvents();
                    } else {
                        cy.request({
                            method: "POST",
                            url: "/api/v1/eventType",
                            body: {
                                "name": "PS1",
                                "description": "Plant%20seed%20"
                            }
                        }).then(({ status, body }) => {
                            cy.get("#Events").click();
                            cy.url().should("include", "/events");
                            cy.wait(15000);
                            cy.get(".ant-tabs-tab").should("have.length", 3);
                            cy.get(".ant-tabs-tab").first().should('have.class', 'ant-tabs-tab-active')
                            cy.get(".ant-tabs-tab").eq(2).should('not.have.class', 'ant-tabs-tab-active')
                          
                            cy.get(".ant-tabs-tab").eq(2).click();
                            cy.get(".ant-tabs-tab").eq(2).should('have.class', 'ant-tabs-tab-active')
                            cy.wait(15000);
                            cy.get("button").contains("Certify Event").should("exist")
                            cy.get("th").eq(4).contains("NAME").should("be.visible");
                            cy.get("th").eq(5).contains("DESCRIPTION").should("be.visible");
                            cy.get("th").eq(6).contains("DATE").should("be.visible");
                            cy.get("th").contains("SUMMARY").should("be.visible");
                            cy.get("th").contains("CERTIFIER").should("be.visible");
                            cy.get("th").contains("CERTIFIED DATE").should("be.visible");
                            cy.get("th").contains("CERTIFIER COMMENTS").should("be.visible");
                            cy.get("th").contains("SERIAL NUMBER").should("be.visible");
                            cy.certifyEvents();
                        })
                    }
                   
                })
            }
        });
    });
});