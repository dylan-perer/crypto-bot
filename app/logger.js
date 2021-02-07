const logger = require("node-color-log");

const logError = (msg) => {
  logger.color("red").log(msg);
};

const logWarn = (msg) => {
  logger.color("yellow").log(msg);
};

const logInfo = (msg) => {
  logger.color("cyan").log(msg);
};

const log = (msg) => {
  logger.color("white").bgColor("black").log(msg);
};
module.exports = {
  logError: logError,
  logWarn: logWarn,
  log: log,
  logInfo: logInfo,
};
