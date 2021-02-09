require("use-strict");
require("dotenv").config();
const express = require("express");
const { logError, logWarn, log, logInfo } = require("./logger");
const { bot } = require("./bot");

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

bot();
