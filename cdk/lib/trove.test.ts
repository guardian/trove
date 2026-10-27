import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Trove } from "./trove";

describe("The Trove stack", () => {
  it("matches the snapshot", () => {
    const app = new App();
    const stack = new Trove(app, "Trove", { stack: "capi", stage: "TEST" });
    const template = Template.fromStack(stack);
    expect(template.toJSON()).toMatchSnapshot();
  });
});
