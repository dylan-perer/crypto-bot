const logger = require("node-color-log");

const logError = (msg) => {
  logger.color("red").log(msg);
};

const logWarn = (msg) => {
  logger.color("yellow").log(msg);
};

const logInfo = (msg) => {
  const date = new Date();
  const dateStr =
    date.getDate() +
    "/" +
    date.getMonth() +
    "/" +
    date.getFullYear() +
    " " +
    date.getHours() +
    ":" +
    date.getMinutes() +
    ":" +
    date.getSeconds();
  logger.color("black").bgColor("cyan").log(`${dateStr} - ${msg}`);
};

const log = (msg) => {
  logger.color("white").bgColor("black").log(msg);
};

const debug = (msg, isDebug) => {
  if (isDebug) logger.color("yellow").bgColor("black").log(msg);
};

module.exports = {
  logError: logError,
  logWarn: logWarn,
  log: log,
  logInfo: logInfo,
  debug: debug,
};
