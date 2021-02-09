const Binance = require("node-binance-api");
const { startListening } = require("../email");
const { logError, logWarn, log, logInfo } = require("../logger");

const config = {
  symbol: "ETHUSDT",
  margin: 4,
  shortStoploss: 0.01,
  shortTakeprofit: 1.2,
};
const LONG = "long";
const SHORT = "short";

const currentTrade = {
  side: null,
  stopLossPrice: null,
  takeProfitPrice: null,
  orderId: null,
  executedQty: null,
  listenToStoploss: false,
};

let liveSymbolData = null;
let currentTradeSide = null;

const binance = new Binance().options({
  APIKEY: process.env.API_KEY,
  APISECRET: process.env.SECRET_KEY,
});

async function getMaxTradeAmount(liveSymbolData) {
  try {
    let account = await binance.futuresAccount();
    let balance = account.assets[0].walletBalance;

    //Calculating max trade amount
    let maxTradeAmount =
      Math.floor(((balance * config.margin) / liveSymbolData.close) * 1000) /
      1000;

    // error margin of 0.01% just to be safe.
    return Math.floor((maxTradeAmount - maxTradeAmount * 0.05) * 1000) / 1000;
  } catch (error) {
    logError(`FAILED TO get max trade amount ::: ${error}`);
  }
}

function logOrder(order) {
  logInfo(
    `MARKET ORDER:: side:${order.side} symbol:${order.symbol} avgPrice: ${order.avgPrice} executedQty:${order.executedQty} status:${order.status}`
  );
}

async function goLong(liveSymbolData) {
  try {
    const maxTradeAmount = await getMaxTradeAmount(liveSymbolData);
    log(maxTradeAmount);

    logInfo("Going long...");
    const order = await binance.futuresMarketBuy(
      config.symbol,
      maxTradeAmount,
      {
        newOrderRespType: "RESULT",
      }
    );
    logOrder(order);
    return order;
  } catch (error) {
    logError(`FAILED to go long ::: ${error}`);
  }
}

async function goShort(liveSymbolData, isExiting = false) {
  try {
    const maxTradeAmount = await getMaxTradeAmount(liveSymbolData);
    log(maxTradeAmount);

    logInfo("Going short...");
    const order = await binance.futuresMarketSell(
      config.symbol,
      maxTradeAmount,
      {
        newOrderRespType: "RESULT",
      }
    );
    logOrder(order);

    if (!isExiting) {
      currentTrade.executedQty = order.executedQty;

      const orderAvgPrice = parseFloat(order.avgPrice);

      currentTrade.stopLossPrice =
        orderAvgPrice + (orderAvgPrice / 100) * config.shortStoploss;

      currentTrade.takeProfitPrice =
        orderAvgPrice - (orderAvgPrice / 100) * config.shortTakeprofit;

      const takeProfitOrder = await binance.futuresBuy(
        config.symbol,
        order.executedQty,
        currentTrade.takeProfitPrice.toFixed(2)
      );

      currentTrade.orderId = takeProfitOrder.orderId;
      logInfo(
        `TAKE PROFIT ORDER:: side:${takeProfitOrder.side} symbol:${takeProfitOrder.symbol} price: ${takeProfitOrder.price}`
      );

      console.log("CURENT TRADE obj");
      console.info(currentTrade);
      currentTrade.side = SHORT;
      currentTrade.listenToStoploss = true;
      checkStopLoss();
    }
    return order;
  } catch (error) {
    logError(`FAILED to go short ::: ${error}`);
  }
}

async function trade(price, side, liveSymbolData, currentTradeSide) {
  log(`CURRENT TRADE SIDE IS ${currentTradeSide}`);
  try {
    if (side === LONG) {
      if (currentTradeSide === SHORT) {
        //check current trade side
        await goLong(liveSymbolData); //to get out of the current trade.
        await goLong(liveSymbolData);
      } else {
        await goLong(liveSymbolData);
      }
      currentTradeSide = LONG;
    } else if (side === SHORT) {
      if (currentTradeSide === LONG) {
        await goShort(liveSymbolData, true);
        await goShort(liveSymbolData);
      } else {
        await goShort(liveSymbolData);
      }
      currentTradeSide = SHORT;
    }
    return currentTradeSide;
  } catch (error) {
    logError(`FAILED to trade ::: ${error}`);
  }
}

const checkStopLoss = async () => {
  // logError("CHECKCING STOP LOSS>....");
  if (liveSymbolData.close >= currentTrade.stopLossPrice) {
    currentTrade.listenToStoploss = false;

    //cancel takeprofit order
    const canceledTakeProfitOrder = await binance.futuresCancelAll(
      config.symbol
    );

    console.log("CANCELED ORDER...");

    const stopLossOrder = await binance.futuresMarketBuy(
      config.symbol,
      currentTrade.executedQty,
      {
        newOrderRespType: "RESULT",
      }
    );

    console.log("STOP LOSS MARKE ORDER PLACED...");

    //close short position.
    logInfo(`Short stoploss hit!`);
    currentTrade.side = null;
    currentTradeSide = null;
  } else {
    setTimeout(() => {
      if (currentTrade.listenToStoploss) checkStopLoss();
    }, 1000);
  }
};

const bot = async () => {
  try {
    const account = await binance.futuresAccount();
    let streamReady = false;
    let isListeningToStopLoss = true;
    logInfo(
      `ACCOUNT:: USDT: $${account.assets[0].walletBalance} BNB:${account.assets[1].walletBalance}`
    );

    binance.futuresMiniTickerStream(config.symbol, async (symbolData) => {
      //Intialising bot
      liveSymbolData = symbolData;

      //Check if stoploss hit or takeprofit hit
      if (currentTrade.side === SHORT) {
        //checking if profit limit order exists anymore
        let positions = await binance.futuresAccount();
        positions.positions.map((item, idx) => {
          if (item.symbol === config.symbol) {
            // console.log("targt hit check", item.entryPrice);
            if (item.entryPrice === 0) {
              logInfo(`Short profit target hit!`);
              currentTrade.side = null;
              currentTradeSide = null;
            }
          }
        });
        //checking if stoploss is hit
      }

      //when price stream is ready
      if (!streamReady && liveSymbolData) {
        streamReady = true;

        //set leverage
        await binance.futuresLeverage(config.symbol, config.margin);
        log("Adjusting leverage complete...");

        logInfo(
          `Max trading amount is ${await getMaxTradeAmount(liveSymbolData)}`
        );
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
  } catch (error) {
    logError(`FAILED to start bot ::: ${error}`);
  }
};

module.exports = { bot: bot };
