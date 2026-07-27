export class AppInspectError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AppInspectError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new AppInspectError(code, message);
};

export function createAppInspectQuery({ applicationStateConnector } = {}) {
  if (typeof applicationStateConnector?.query !== "function")
    fail(
      "app_inspect_owner_invalid",
      "app.inspect requires the application-state connector",
    );
  return async (argumentsValue = {}) => {
    if (
      !argumentsValue ||
      typeof argumentsValue !== "object" ||
      Array.isArray(argumentsValue) ||
      Object.keys(argumentsValue).length
    )
      fail(
        "app_inspect_arguments_invalid",
        "app.inspect accepts a closed empty argument object",
      );
    return applicationStateConnector.query("app.inspect", {});
  };
}
