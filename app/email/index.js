const MailListener = require("mail-listener2");
const { logError, logWarn, log, logInfo } = require("../logger");

let mailListener = null;
const startDateTime = new Date();
let counter = 0;

let done = false;
const parseAlert = (mail, onAlert) => {
  log(mail.subject);
  try {
    const subject = mail.subject;
    const regexSide = /(buy(?=\sposition))|(sell(?=\sposition))/g;
    const regexTrailStop = /(\s(0(?=$)))/g;
    const sideRes = subject.match(regexSide);
    const trailRes = subject.match(regexTrailStop);

    let alert = new Date().toDateString() + " ";
    console.log(new Date().toDateString(), sideRes);

    let alertType = null;

    if (trailRes !== null) {
      alert + "stoploss hit";
      alertType = "stoploss";
    } else {
      alert + " new entry " + sideRes;
      sideRes === "buy" ? "LONG" : "SHORT";
      alertType = sideRes[0];
    }
    onAlert(alertType);
  } catch (error) {
    console.log("Unparseable alert");
  }
};

const createNewMailListener = (onAlert) => {
  mailListener = new MailListener({
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
    fetchUnreadOnStart: true, // use it only if you want to get all unread email on lib start. Default is `false`,
    mailParserOptions: { streamAttachments: true }, // options to be passed to mailParser lib.
    attachments: true, // download attachments as they are encountered to the project directory
    attachmentOptions: { directory: "attachments/" }, // specify a download directory for attachments
  });

  mailListener.start();

  mailListener.on("server:connected", function () {
    log("imap connected...");
    // if (!done) {
    //   setTimeout(() => {
    //     log("disconecting...");
    //     mailListener.stop();
    //     done = true;
    //   }, 2000);
    // }
  });

  mailListener.on("server:disconnected", function () {
    log("imap disconnected");
    setTimeout(() => {
      log("trying to reconnect...");
      createNewMailListener(onAlert);
      // counter++;
      // if (counter < 2) done = false;
    }, 1500);
  });

  mailListener.on("error", function (err) {
    if (err) {
      logError(`imaperror ${err}`);
    }
  });

  mailListener.on("mail", function (mail, seqno, attributes) {
    if (mail.date > startDateTime)
      if (mail.date > startDateTime) parseAlert(mail, onAlert);
  });
};

const startListening = async (onAlert) => {
  createNewMailListener(onAlert);
};

module.exports = { startListening: startListening, parseAlert: parseAlert };
