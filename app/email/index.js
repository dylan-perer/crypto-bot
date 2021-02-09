const notifier = require("mail-notifier");
const { logError, logWarn, log, logInfo } = require("../logger");

const imap = {
  user: "stonks9199@outlook.com",
  password: "Wow0211805656",
  host: "outlook.office365.com",
  port: 993, // imap port
  tls: true, // use secure connection
  tlsOptions: { rejectUnauthorized: false },
};
const startDateTime = new Date();
const n = notifier(imap);

const startListening = (onAlert) => {
  log("Alert listener ready @ " + startDateTime);
  n.on("end", () => n.start()) // session closed
    .on("mail", (mail) => {
      if (mail.date > startDateTime) parseAlert(mail, onAlert);
    })
    .start();
};

const parseAlert = (mail, onAlert) => {
  log(mail.subject);
  try {
    const regex = /(\d+.\d+|\d+)/g;
    const alertDetails = mail.subject.match(regex);
    if (
      (alertDetails[3] && alertDetails[3] === "1111") ||
      alertDetails[3] === "1000"
    ) {
      const side = alertDetails[3] === "1111" ? "long" : "short";
      logInfo(
        `ALERT:: ${new Date(mail.date).toDateString()} ${new Date(
          mail.date
        ).toTimeString()} ${mail.from[0].address} price: $${
          alertDetails[0]
        } @ ${side}`
      );
      onAlert(alertDetails[0], side);
    }
  } catch (error) {}
};

module.exports = { startListening: startListening };
