var MailListener = require("mail-listener2");
const { logError, logWarn, log, logInfo } = require("../logger");

var mailListener = new MailListener({
  username: process.env.EMAIL,
  password: process.env.EMAIL_PSW,
  host: "outlook.office365.com",
  port: 993, // imap port
  tls: true,
  connTimeout: 10000, // Default by node-imap
  authTimeout: 5000, // Default by node-imap,
  debug: () => {}, // Or your custom function with only one incoming argument. Default: null
  tlsOptions: { rejectUnauthorized: false },
  mailbox: "INBOX", // mailbox to monitor
  searchFilter: ["UNSEEN"], // the search filter being used after an IDLE notification has been retrieved
  markSeen: true, // all fetched email willbe marked as seen and not fetched next time
  fetchUnreadOnStart: false, // use it only if you want to get all unread email on lib start. Default is `false`,
  mailParserOptions: { streamAttachments: true }, // options to be passed to mailParser lib.
  attachments: true, // download attachments as they are encountered to the project directory
  attachmentOptions: { directory: "attachments/" }, // specify a download directory for attachments
});

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

const startListening = async (onAlert) => {
  const startDateTime = new Date();

  mailListener.start(); // start listening

  mailListener.on("server:connected", function () {
    log("imapConnected");
  });

  mailListener.on("server:disconnected", function () {
    log("imapDisconnected");
    log("Attempting to restart");
    mailListener.start();
  });

  mailListener.on("error", function (err) {
    logError(`imaperror ${err}`);
    log("Attempting to restart");
    mailListener.start();
  });

  mailListener.on("mail", function (mail, seqno, attributes) {
    if (mail.date > startDateTime)
      if (mail.date > startDateTime) parseAlert(mail, onAlert);
  });
};

module.exports = { startListening: startListening };
