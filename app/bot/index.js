const Binance = require("node-binance-api");
const {
  logError,
  logWarn,
  log,
  logInfo,
  debug,
  setDebugMode,
} = require("../logger");

const { startListening } = require("../email");
const { LONG, SHORT } = require("./constants");

module.exports = class Bot {
  constructor(
    {
      symbol,
      margin,
      shortStoploss,
      shortTakeprofit,
      longStoploss,
      longTakeprofit,
    },
    {
      alreadySide,
      alreadyEntryPrice,
      alreadyExecutedQty,
      alreadyShortStoploss,
      alreadyShortTakeprofit,
    },
    isDebug
  ) {
    this.config = {
      symbol: symbol,
      margin: margin,

      shortStoplossPercentage: shortStoploss,
      shortTakeprofitPercentage: shortTakeprofit,
      longStoplossPercentage: longStoploss,
      longTakeprofitPercentage: longTakeprofit,
    };

    this.state = {
      side: null,

      shortStoploss: null,
      shortTakeprofit: null,
      longStoploss: null,
      longTakeprofit: null,

      orderId: null,
      executedQty: null,
      currentPrice: null,
      currentProfit: null,
      takeProfitOrderId: null,

      isStreamReady: false,
      isBotOn: false,
      isBotStarting: false,
      listenToShortExit: false,
      listenToLongExit: false,
    };

    //options
    this.debug = isDebug;

    debug(`Bot configured :: ${JSON.stringify(this.config)}`, isDebug);
    debug(`Bot current state :: {${JSON.stringify(this.state)}}`, isDebug);

    //start price stream
    this.getNewBinnaceObject().futuresMiniTickerStream(
      this.config.symbol,
      this.tick
    );

    // //already in trade
    // if(alreadySide){
    //   if(alreadySide===SHORT){
    //     this.state.executedQty = alreadyExecutedQty;

    //   }
    // }
  }

  getNewBinnaceObject() {
    return new Binance().options({
      APIKEY: process.env.API_KEY,
      APISECRET: process.env.SECRET_KEY,
    });
  }

  async getBalanceInUSDT() {
    try {
      const account = await this.getNewBinnaceObject().futuresAccount();
      return account.assets[0].walletBalance;
    } catch (error) {
      logError(`Error getting balance in USDT ::: ${error}`);
    }
  }

  //Calculate the maximum tradeable amount
  async getMaxTradeAmount() {
    try {
      let balance = null;
      while (balance == null) {
        try {
          balance = await this.getBalanceInUSDT();
        } catch (error) {
          logError(`failed to get balance, trying again...`);
          balance = null;
        }
      }
      //Calculating max trade amount
      const maxTradeAmount =
        Math.floor(
          ((balance * this.config.margin) / this.state.currentPrice) * 1000
        ) / 1000;

      // error margin of 0.01% just to be safe.
      return Math.floor((maxTradeAmount - maxTradeAmount * 0.05) * 1000) / 1000;
    } catch (error) {
      logError(`Failed to get max trade amount ::: ${error}`);
    }
  }

  //Price stream tick, updates when price changes
  tick = (symbolData) => {
    this.state.currentPrice = symbolData.close;
    this.state.isStreamReady = true;
  };

  placeMarketOrderBuy = async (msg = "Long") => {
    try {
      const maxTradeAmount = await this.getMaxTradeAmount();

      const order = await this.getNewBinnaceObject().futuresMarketBuy(
        this.config.symbol,
        maxTradeAmount,
        {
          newOrderRespType: "RESULT",
        }
      );
      let { orderId, symbol, status, avgPrice, origQty } = order;
      logInfo(
        `${msg} market order placed. id: ${orderId} symbol: ${symbol} status: ${status} avgPrice: ${avgPrice} origQty: ${origQty}`
      );
      return order;
    } catch (error) {
      logError(`Failed to place market buy order ::: ${error}`);
    }
  };

  placeMarketOrderSell = async (msg = "Short") => {
    try {
      const maxTradeAmount = await this.getMaxTradeAmount();

      const order = await this.getNewBinnaceObject().futuresMarketSell(
        this.config.symbol,
        maxTradeAmount,
        {
          newOrderRespType: "RESULT",
        }
      );
      let { orderId, symbol, status, avgPrice, origQty } = order;
      logInfo(
        `${msg} market order placed. id: ${orderId} symbol: ${symbol} status: ${status} avgPrice: ${avgPrice} origQty: ${origQty}`
      );
      return order;
    } catch (error) {
      logError(`Failed to place market sell order ::: ${error}`);
    }
  };

  onAlert = async (price, side) => {
    try {
      if (side === LONG) {
        if (this.state.side === SHORT) {
          //stop listening to exit
          this.state.listenToShortExit = false;
          //cancel takeprofit order
          this.cancelLimitOrder(this.state.takeProfitOrderId);
          //exit short position
          const exitShort = await this.placeMarketOrderBuy("Exit short");
          logInfo(`Current short position was exited.`);
          debug(`${JSON.stringify(exitShort)}`, this.debug);

          //go into new long position
          this.long();
        } else {
          this.long();
        }
      } else if (side === SHORT) {
        if (this.state.side === LONG) {
          //stop listening to exit
          this.state.listenToLongExit = false;
          //cancel takeprofit order
          this.cancelLimitOrder(this.state.takeProfitOrderId);
          //exit short position
          const exitLong = await this.placeMarketOrderSell("Exit long");
          logInfo(`Current long position was exited.`);
          debug(`${JSON.stringify(exitLong)}`, this.debug);
          //go into new long position
          this.short();
        } else {
          this.short();
        }
      }
    } catch (error) {
      logError(`Failed on alert ::: ${error}`);
    }
  };

  getOrderStatus = async (orderId) => {
    try {
      return await this.getNewBinnaceObject().futuresOrderStatus(
        this.config.symbol,
        {
          orderId: "" + orderId,
        }
      );
    } catch (error) {
      logError(`Failed to get order status ::: ${error}`);
    }
  };

  cancelLimitOrder = async (orderId) => {
    try {
      return await this.getNewBinnaceObject().futuresCancel(
        this.config.symbol,
        {
          orderId: "" + orderId,
        }
      );
    } catch (error) {
      logError(`Failed to cancel limit order ::: ${error}`);
      return null;
    }
  };

  longExitListener = async () => {
    logWarn("(LONG)...");
    try {
      const { executedQty } = await this.getOrderStatus(
        this.state.takeProfitOrderId
      );
      if (this.state.listenToLongExit) {
        //Check if takeprofit order is filled
        if (executedQty === this.state.executedQty) {
          //take profit order is complete
          logInfo(`Take profit order comepleted!`);
          this.state.listenToLongExit = false;
          this.state.side = null;
        }
        //check if stoploss is met
        else if (this.state.currentPrice <= this.state.longStoploss) {
          //cancel takeprofit
          await this.cancelLimitOrder(this.state.takeProfitOrderId);

          //market exit
          const stopLossOrder = await this.placeMarketOrderSell(
            "(LONG) stoploss"
          );

          this.state.listenToLongExit = false;
          this.state.side = null;
        } else {
          setTimeout(() => {
            this.longExitListener();
          }, 1000);
        }
      }
    } catch (error) {
      logError(`Failed to listen for long exit ::: ${error}`);
    }
  };

  shortExitListener = async () => {
    logWarn("(SHORT)...");
    try {
      const { executedQty } = await this.getOrderStatus(
        this.state.takeProfitOrderId
      );
      if (this.state.listenToShortExit) {
        //Check if takeprofit order is filled
        if (executedQty === this.state.executedQty) {
          //take profit order is complete
          logInfo(`Take profit order comepleted!`);
          this.state.listenToShortExit = false;
          this.state.side = null;
        }
        //check if stoploss is met
        else if (this.state.currentPrice >= this.state.shortStoploss) {
          //cancel takeprofit
          await this.cancelLimitOrder(this.state.takeProfitOrderId);

          //market exit
          const stopLossOrder = await this.placeMarketOrderBuy(
            "(SHORT) stoploss"
          );

          this.state.listenToShortExit = false;
          this.state.side = null;
        } else {
          setTimeout(() => {
            this.shortExitListener();
          }, 1000);
        }
      }
    } catch (error) {
      logError(`Failed to listen for short exit ::: ${error}`);
    }
  };

  short = async () => {
    try {
      //place short market order
      const order = await this.placeMarketOrderSell();

      //calulate and set take profit & stop loss values
      const orderAvgPrice = parseFloat(order.avgPrice);
      this.state.executedQty = order.origQty;
      this.state.shortStoploss =
        orderAvgPrice +
        (orderAvgPrice / 100) * this.config.shortStoplossPercentage;
      this.state.shortTakeprofit =
        orderAvgPrice -
        (orderAvgPrice / 100) * this.config.shortTakeprofitPercentage;

      //place take profit limit order
      const takeProfitOrder = await this.getNewBinnaceObject().futuresBuy(
        this.config.symbol,
        order.executedQty,
        this.state.shortTakeprofit.toFixed(2)
      );

      this.state.takeProfitOrderId = takeProfitOrder.orderId;
      this.state.side = SHORT;
      logInfo(
        `Take profit limit order placed. id: ${takeProfitOrder.orderId} symbol: ${takeProfitOrder.symbol} status: ${takeProfitOrder.status} price: ${takeProfitOrder.price} origQty: ${takeProfitOrder.origQty} executedQty: ${takeProfitOrder.executedQty}`
      );

      //start listening to exit strats
      this.state.listenToShortExit = true;
      debug(
        `State after a short position is set ${JSON.stringify(this.state)}`,
        this.debug
      );
      logWarn("(SHORT) Listening for a exit..");
      this.shortExitListener();
    } catch (error) {
      logError(`Erorr going short ::: ${error}`);
      //send err notifcation
    }
  };

  long = async () => {
    try {
      //place short market order
      const order = await this.placeMarketOrderBuy();

      //calulate and set take profit & stop loss values
      const orderAvgPrice = parseFloat(order.avgPrice);
      this.state.executedQty = order.origQty;
      this.state.longStoploss =
        orderAvgPrice -
        (orderAvgPrice / 100) * this.config.longStoplossPercentage;

      this.state.longTakeprofit =
        orderAvgPrice +
        (orderAvgPrice / 100) * this.config.longTakeprofitPercentage;

      //place take profit limit order
      const takeProfitOrder = await this.getNewBinnaceObject().futuresSell(
        this.config.symbol,
        order.executedQty,
        this.state.longTakeprofit.toFixed(2)
      );

      this.state.takeProfitOrderId = takeProfitOrder.orderId;
      this.state.side = LONG;

      logInfo(
        `Take profit limit order placed. id: ${takeProfitOrder.orderId} symbol: ${takeProfitOrder.symbol} status: ${takeProfitOrder.status} price: ${takeProfitOrder.price} origQty: ${takeProfitOrder.origQty} executedQty: ${takeProfitOrder.executedQty}`
      );

      //start listening to exit strats
      this.state.listenToLongExit = true;
      debug(
        `State after a long position is set ${JSON.stringify(this.state)}`,
        this.debug
      );
      logWarn("(LONG) Listening for a exit..");
      this.longExitListener();
    } catch (error) {
      logError(`Erorr going long ::: ${error}`);
      //send err notifcation
    }
  };

  startBot = async () => {
    try {
      if (this.state.currentPrice !== null && this.state.isStreamReady) {
        startListening(this.onAlert);
        log(`Bot has started...`);
        logInfo(`Balance is ${await this.getBalanceInUSDT()} USDT`);
        const margin = await this.getNewBinnaceObject().futuresLeverage(
          this.config.symbol,
          this.config.margin
        );
        logInfo(`Margin adjusted to x${margin.leverage}`);
        logInfo(
          `Your max trading amount is  ${await this.getMaxTradeAmount(
            this.state.currentPrice
          )}`
        );
      }
    } catch (error) {
      logError(`Failed to start the bot ::: ${error}`);
    }
  };
};
