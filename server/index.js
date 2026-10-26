import { createApp } from "./app.js";

const { server, config, calendar } = createApp();
server.listen(config.port, config.host, () => {
  console.log(`ASBS ${config.environment} server at http://${config.host}:${config.port}`);
  console.log(`Google Calendar: ${calendar.configured ? "connected" : "not connected"}`);
  console.log(`Dashboard password: ${config.dashboardPassword ? "configured" : "not configured"}`);
  if (config.sessionSecretEphemeral) {
    console.log("ASBS_SESSION_SECRET is not set. Dashboard sign-in will reset when the server restarts.");
  }
});
