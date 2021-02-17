require("use-strict");
require("dotenv").config();
const express = require("express");
const { logError, logWarn, log, logInfo } = require("./logger");
const Bot = require("./bot");

const app = express();
const PORT = 5500;

app.get("/api/account", async (req, res) => {
  try {
    const account = await binance.futuresAccount();

    return res.status(200).json({
      USDT: account.assets[0].walletBalance,
      BNB: account.assets[1].walletBalance,
    });
  } catch (error) {
    res.status(404).status("Error: failed to get account details.");
  }
});

app.listen(PORT, () => {
  log("App started...");
});

const config = {
  symbol: "ETHUSDT",

  margin: process.env.margin,
  shortStoploss: process.env.shortStoploss,
  shortTakeprofit: process.env.shortTakeprofit,

  longStoploss: process.env.longStoploss,
  longTakeprofit: process.env.longTakeprofit,
};

// const alreadyInTrade = {
//   alreadySide: "short",
//   alreadyEntryPrice: 1767.83,
//   alreadyExecutedQty: 0.568,
//   alreadyShortStoploss: 1803.1866,
//   alreadyShortTakeprofit: 1749.798134,
// };

let bot = new Bot(config, alreadyInTrade, true);
setTimeout(() => {
  bot.startBot();
}, 3000);
