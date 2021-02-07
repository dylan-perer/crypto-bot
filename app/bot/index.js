const Binance = require("node-binance-api");
const { startListening } = require("../email");
const { logError, logWarn, log, logInfo } = require("../logger");

const config = {
  symbol: "ETHUSDT",
  margin: 3,
};
const LONG = "long";
const SHORT = "short";

const binance = new Binance().options({
  APIKEY: process.env.API_KEY,
  APISECRET: process.env.SECRET_KEY,
});

async function getMaxTradeAmount(liveSymbolData) {
  let account = await binance.futuresAccount();
  let balance = account.assets[0].walletBalance;

  //Calculating max trade amount
  let maxTradeAmount =
    Math.floor(((balance * config.margin) / liveSymbolData.close) * 1000) /
    1000;

  // error margin of 0.01% just to be safe.
  return Math.floor((maxTradeAmount - maxTradeAmount * 0.01) * 1000) / 1000;
}

function logOrder(order) {
  logInfo(
    `MARKET ORDER:: side:${order.side} symbol:${order.symbol} avgPrice: ${order.avgPrice} executedQty:${order.executedQty} status:${order.status}`
  );
}

async function goLong(liveSymbolData) {
  const maxTradeAmount = await getMaxTradeAmount(liveSymbolData);
  log(maxTradeAmount);

  logInfo("Going long...");
  const order = await binance.futuresMarketBuy(config.symbol, maxTradeAmount, {
    newOrderRespType: "RESULT",
  });

  logOrder(order);
  return order;
}

async function goShort(liveSymbolData) {
  const maxTradeAmount = await getMaxTradeAmount(liveSymbolData);
  log(maxTradeAmount);

  logInfo("Going short...");
  const order = await binance.futuresMarketSell(config.symbol, maxTradeAmount, {
    newOrderRespType: "RESULT",
  });
  logOrder(order);
  return order;
}

async function trade(price, side, liveSymbolData, currentTradeSide) {
  log(`CURRENT TRADE SIDE IS ${currentTradeSide}`);
  try {
    if (side === LONG) {
      if (currentTradeSide === SHORT) {
        await goLong(liveSymbolData); //to get out of the current trade.
        await goLong(liveSymbolData);
      } else {
        await goLong(liveSymbolData);
      }
      currentTradeSide = LONG;
    } else if (side === SHORT) {
      if (currentTradeSide === LONG) {
        await goShort(liveSymbolData);
        await goShort(liveSymbolData);
      } else {
        await goShort(liveSymbolData);
      }
      currentTradeSide = SHORT;
    }
    return currentTradeSide;
  } catch (error) {
    logError("" + error);
  }
}

const bot = async () => {
  const account = await binance.futuresAccount();
  let streamReady = false;
  let currentTradeSide = null;

  logInfo(
    `ACCOUNT:: USDT: $${account.assets[0].walletBalance} BNB:${account.assets[1].walletBalance}`
  );

  let liveSymbolData = null;

  binance.futuresMiniTickerStream(config.symbol, async (symbolData) => {
    //Intialising bot
    liveSymbolData = symbolData;

    //when price stream is ready
    if (!streamReady && liveSymbolData) {
      streamReady = true;

      //set leverage
      await binance.futuresLeverage(config.symbol, config.margin);
      log("Adjusting leverage complete...");

      //start email listener
      startListening(async (price, side) => {
        currentTradeSide = await trade(
          price,
          side,
          liveSymbolData,
          currentTradeSide
        );
      });
    }
    if (!symbolData) logError("failed to get symbol stream...");
  });
};

module.exports = { bot: bot };
