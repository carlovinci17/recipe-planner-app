import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import { OrchestrationContext, OrchestrationHandler } from "durable-functions";

const activityName = "sayHello";

// ── Activity: the unit of real work. In the real pipeline, a step's I/O or
//    model call lives here. Retried/checkpointed independently.
df.app.activity(activityName, {
  handler: (city: string): string => `Hello, ${city}!`,
});

// ── Orchestrator: the recipe of steps. Deterministic + replayable — NO I/O,
//    only activity calls. Fans out to 3 activities, then fans in.
const helloOrchestrator: OrchestrationHandler = function* (context: OrchestrationContext) {
  const cities = ["Tokyo", "Seattle", "Cairo"];
  const tasks = cities.map((c) => context.df.callActivity(activityName, c));
  const results: string[] = yield context.df.Task.all(tasks); // fan-in: wait for all
  return results;
};
df.app.orchestration("helloOrchestrator", helloOrchestrator);

// ── HTTP starter: kicks off the orchestration, returns status URLs to poll.
app.http("helloStart", {
  route: "orchestrators/hello",
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const client = df.getClient(context);
    const instanceId = await client.startNew("helloOrchestrator");
    context.log(`Started orchestration '${instanceId}'.`);
    return client.createCheckStatusResponse(req, instanceId);
  },
});
