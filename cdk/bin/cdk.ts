import "source-map-support/register";
import { GuRoot } from "@guardian/cdk/lib/constructs/root";
import { Trove } from "../lib/trove";

const app = new GuRoot();
new Trove(app, "Trove-euwest-1-CODE", { stack: "capi", stage: "CODE", env: { region: "eu-west-1" } });
