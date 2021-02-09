const notifier = require("mail-notifier");
const { logError, logWarn, log, logInfo } = require("../logger");

const imap = {
  user: process.env.EMAIL,
  password: process.env.EMAIL_PSW,
  host: "outlook.office365.com",
  port: 993, // imap port
  tls: true, // use secure connection
  tlsOptions: { rejectUnauthorized: false },
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

const maillCon = async () => {
  try {
    await n.start();
    n.on("mail", (mail) => {
      if (mail.date > startDateTime) parseAlert(mail, onAlert);
    });
  } catch (error) {
    logError(`ERROR starting mail ::: ${error}`);
  }
};

const startListening = async (onAlert) => {
  const startDateTime = new Date();
  const n = notifier(imap);
  // try {
  //   await maillCon();
  // } catch (error) {
  //   log(`Attemting to reconnect ${error}`);
  //   await maillCon();
  //   n.on("mail", (mail) => log(`${mail.subject}`));
  // }
  n.on("end", () => n.start()) // session closed
    .on("mail", (mail) => {
      if (mail.date > startDateTime) parseAlert(mail, onAlert);
    })
    .start();
};

module.exports = { startListening: startListening };
